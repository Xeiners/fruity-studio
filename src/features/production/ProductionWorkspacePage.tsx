import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronLeft,
  Clapperboard,
  CloudAlert,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileVideo,
  FolderOutput,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { CopyButton, copyToClipboard } from "@/components/common/CopyButton";
import { ErrorState, EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@/components/ui/menus";
import { invalidate, qk, useCharacters, useFfmpeg, useProduction, useSettings } from "@/hooks/queries";
import { generateProduction, regenerateClip } from "@/services/gemini/generator";
import { parseClipContent, type ClipContent } from "@/services/gemini/schemas";
import { charactersApi } from "@/services/storage/characters";
import { productionsApi } from "@/services/storage/productions";
import { systemApi } from "@/services/storage/system";
import type { Clip, ProductionDetail } from "@/types";
import { VIDEO_EXTENSIONS } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { formatSeconds } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";
import { CLIP_STATE_LABEL, clipState, productionProgress } from "@/utils/status";
import { ExportReferencesDialog } from "@/features/characters/ExportReferencesDialog";
import { GenerationErrorNotice, GenerationProgress } from "@/features/stories/GenerationStatus";
import { InventCharactersOption } from "@/features/stories/InventCharactersOption";
import { useGeneration } from "@/features/stories/useGeneration";
import { BulkImportDialog } from "./BulkImportDialog";
import { ClipCard } from "./ClipCard";
import { ClipEditDialog } from "./ClipEditDialog";
import { recomposePrompt } from "./compose";
import { allPromptsText, productionMarkdown } from "./exportText";
import { RegenerateClipDialog } from "./RegenerateClipDialog";
import { RenderPanel } from "./RenderPanel";
import { StoryOverview, type StoryEdit } from "./StoryOverview";
import { useClipImport, VIDEO_FILTER } from "./useClipImport";
import { useRenderState } from "./renderStore";

const FLOW_URL = "https://labs.google/fx/tools/flow";

type SaveState = "idle" | "saving" | "saved" | "error";

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Enregistrement…
      </span>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-destructive">
        <CloudAlert className="size-3.5" /> Non enregistré
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Check className="size-3.5 text-success" /> Enregistré
    </span>
  );
}

function TitleEditor({ title, onSave }: { title: string; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(title), [title]);
  const commit = () => {
    const v = value.trim();
    if (!v) setValue(title);
    else if (v !== title) onSave(v);
  };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") ref.current?.blur();
        if (e.key === "Escape") {
          setValue(title);
          setTimeout(() => ref.current?.blur());
        }
      }}
      maxLength={120}
      aria-label="Titre de la production"
      className="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[19px] font-semibold tracking-[-0.01em] transition-colors outline-none hover:border-border focus:border-ring/60 focus:bg-surface"
    />
  );
}

function ProgressStrip({ production }: { production: ProductionDetail }) {
  const progress = productionProgress(production);
  const next = production.clips.find((c) => !c.video);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          <span className="font-semibold">
            {progress.imported}/{progress.total} vidéos importées
          </span>
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            {next
              ? `Prochaine étape : copiez le prompt du clip ${next.clipNumber}, générez-le dans Google Flow, puis importez la vidéo.`
              : production.finalVideo && !progress.renderOutdated
                ? "Vidéo finale prête."
                : "Tout est importé : lancez le rendu final."}
          </span>
        </p>
        <Button variant="ghost" size="xs" onClick={() => void openUrl(FLOW_URL)}>
          <ExternalLink /> Ouvrir Google Flow
        </Button>
      </div>
      <div className="flex gap-1.5">
        {production.clips.map((clip) => {
          const state = clipState(clip, production);
          return (
            <Tooltip key={clip.id} content={`Clip ${clip.clipNumber} — ${CLIP_STATE_LABEL[state]}`}>
              <button
                type="button"
                onClick={() => document.getElementById(`clip-${clip.clipNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={cn(
                  "flex h-7 flex-1 items-center justify-center rounded-md border font-mono text-[11px] transition-colors",
                  state === "awaiting" && "border-dashed border-border text-muted-foreground hover:bg-accent/50",
                  state === "imported" && "border-orange/40 bg-orange-soft text-orange",
                  state === "ready" && "border-primary/45 bg-lime-soft text-primary-strong",
                  state === "rendered" && "border-success/40 bg-success/12 text-success",
                )}
              >
                {String(clip.clipNumber).padStart(2, "0")}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function ProductionWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const { data: production, isLoading, isError, error, refetch } = useProduction(id);
  const { data: library } = useCharacters(true);
  const { data: settings } = useSettings();
  const render = useRenderState();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [exportOpen, setExportOpen] = useState(false);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [regenClip, setRegenClip] = useState<Clip | null>(null);
  const [bulkPaths, setBulkPaths] = useState<string[] | null>(null);
  const [storyRegenOpen, setStoryRegenOpen] = useState(false);
  const inventCharacters = useRef(false);
  const clipGeneration = useGeneration();
  const storyGeneration = useGeneration();
  const { importFor, pickFor, removeFrom, busyClip } = useClipImport(production?.clips.length ?? 0);
  const { data: ffmpeg } = useFfmpeg();
  const analyzedFor = useRef<string | null>(null);

  // Videos importees avant l'installation de FFmpeg : analyse et miniatures a posteriori.
  useEffect(() => {
    if (!production || !ffmpeg?.found || analyzedFor.current === production.id) return;
    if (!production.clips.some((c) => c.video?.fileExists && c.video.durationMs == null)) return;
    analyzedFor.current = production.id;
    productionsApi
      .analyzeClips(production.id)
      .then((count) => count > 0 && invalidate(client, "production", "productions", "media"))
      .catch(() => undefined);
  }, [production, ffmpeg, client]);

  const persist = async (task: () => Promise<unknown>) => {
    setSaveState("saving");
    try {
      await task();
      invalidate(client, "production", "productions");
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      notifyError(e, "Enregistrement impossible");
      throw e;
    }
  };

  if (isError) {
    return (
      <div className="p-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !production) {
    return (
      <div className="flex flex-col gap-6 p-8">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const progress = productionProgress(production);
  const total = production.clips.length * production.clipDuration;

  const fetchCharacters = () =>
    Promise.all(production.characters.map((c) => client.fetchQuery({ queryKey: qk.character(c.id), queryFn: () => charactersApi.get(c.id), staleTime: 0 })));

  const saveClipContent = async (clip: Clip, content: ClipContent) => {
    const flowPrompt = recomposePrompt(production, content, library ?? []);
    await persist(() => productionsApi.updateClip(clip.id, { content, flowPrompt, promptEdited: false }));
  };

  const runClipRegeneration = async (clip: Clip, instruction: string) => {
    if (!settings) return;
    try {
      const result = await clipGeneration.run(async ({ signal, onPhase }) => {
        const characters = await fetchCharacters();
        return regenerateClip({ production, characters, clipNumber: clip.clipNumber, instruction, model: settings.geminiModel }, { signal, onPhase });
      });
      if (!result) return;
      await persist(() => productionsApi.updateClip(clip.id, { content: result.content, flowPrompt: result.flowPrompt, promptEdited: false }));
      notifySuccess(`Clip ${clip.clipNumber} régénéré`, "Le nouveau prompt est prêt à être copié.");
      setRegenClip(null);
    } catch {
      // erreur affichee dans la boite de dialogue
    }
  };

  const runStoryRegeneration = async () => {
    if (!settings) return;
    const p = production.params;
    try {
      const result = await storyGeneration.run(async ({ signal, onPhase }) => {
        const characters = await fetchCharacters();
        const generated = await generateProduction(
          {
            title: production.title,
            characters,
            storyIdea: p.storyIdea ?? "",
            comedyStyle: p.comedyStyle ?? "mixed",
            targetDuration: production.targetDuration,
            clipDuration: production.clipDuration,
            language: p.language ?? "fr",
            promptLanguage: p.promptLanguage ?? "en",
            musicMode: p.musicMode ?? "flow",
            additionalInstructions: p.additionalInstructions ?? "",
            inventCharacters: inventCharacters.current,
            continuity: null,
            model: settings.geminiModel,
          },
          { signal, onPhase },
        );
        return productionsApi.replaceStory(production.id, {
          title: null,
          synopsis: generated.synopsis,
          targetDuration: production.targetDuration,
          clipDuration: production.clipDuration,
          params: { ...generated.params, continuityProductionId: p.continuityProductionId ?? null },
          story: generated.story,
          characterIds: production.characters.map((c) => c.id),
          clips: generated.clips,
        });
      });
      if (!result) return;
      invalidate(client, "production", "productions", "media", "stats");
      setStoryRegenOpen(false);
      notifySuccess("Nouvelle histoire générée", "Les anciennes vidéos restent disponibles dans la médiathèque.");
    } catch {
      // erreur affichee dans la boite de dialogue
    }
  };

  const confirmStoryRegeneration = async () => {
    inventCharacters.current = Boolean(production.params.inventCharacters);
    const ok = await confirm({
      title: "Régénérer toute l'histoire ?",
      description: (
        <div className="flex flex-col gap-3">
          <p>
            {progress.imported > 0
              ? `Tous les clips seront remplacés. Les ${progress.imported} vidéo(s) importée(s) seront détachées (elles restent dans la médiathèque).`
              : "Tous les clips et leurs prompts seront remplacés par une nouvelle histoire."}
          </p>
          <InventCharactersOption defaultChecked={inventCharacters.current} onChange={(value) => (inventCharacters.current = value)} />
        </div>
      ),
      confirmLabel: "Régénérer",
    });
    if (ok) {
      setStoryRegenOpen(true);
      void runStoryRegeneration();
    }
  };

  const saveStory = async (edit: StoryEdit) => {
    await persist(async () => {
      await productionsApi.update(production.id, { title: edit.title, synopsis: edit.synopsis, story: edit.story });
      // Recompose les prompts non retouches a la main avec le nouveau style / descripteurs.
      const updated = { ...production, title: edit.title, synopsis: edit.synopsis, story: edit.story };
      for (const clip of production.clips) {
        const content = parseClipContent(clip.content);
        if (!content || clip.promptEdited) continue;
        const flowPrompt = recomposePrompt(updated, content, library ?? []);
        if (flowPrompt !== clip.flowPrompt) await productionsApi.updateClip(clip.id, { flowPrompt });
      }
    });
  };

  const exportDocument = async (kind: "md" | "txt") => {
    const path = await saveDialog({
      defaultPath: `${production.title.replace(/[<>:"/\\|?*]/g, " ").trim()}${kind === "md" ? " - production.md" : " - prompts.txt"}`,
      filters: kind === "md" ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "Texte", extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      await systemApi.exportTextFile(path, kind === "md" ? productionMarkdown(production) : allPromptsText(production));
      notifySuccess("Export terminé", path);
    } catch (e) {
      notifyError(e, "Export impossible");
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer « ${production.title} » ?`,
      description: "Les clips, prompts et vidéos importées (copies gérées) seront supprimés. Les vidéos finales déjà exportées restent sur votre disque.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await productionsApi.remove(production.id);
      invalidate(client, "productions", "stats", "media", "characters", "character");
      navigate("/productions", { replace: true });
      notifySuccess("Production supprimée");
    } catch (e) {
      notifyError(e, "Suppression impossible");
    }
  };

  const pickMany = async () => {
    const selected = await openDialog({ multiple: true, filters: VIDEO_FILTER, title: "Vidéos générées par Google Flow" });
    if (Array.isArray(selected) && selected.length) setBulkPaths(selected);
    else if (typeof selected === "string") setBulkPaths([selected]);
  };

  const rendering = render.running && render.productionId === production.id;
  const statusBadge = production.finalVideo
    ? progress.renderOutdated
      ? { label: "Rendu à refaire", variant: "orange" as const }
      : { label: "Terminée", variant: "success" as const }
    : progress.allImported
      ? { label: "Prête pour le rendu", variant: "lime" as const }
      : progress.imported > 0
        ? { label: "Import des vidéos", variant: "orange" as const }
        : { label: "Prompts prêts", variant: "default" as const };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/88 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-8 py-3 xl:px-10">
          <Tooltip content="Productions">
            <Button asChild variant="ghost" size="icon-sm" aria-label="Retour aux productions">
              <Link to="/productions">
                <ChevronLeft />
              </Link>
            </Button>
          </Tooltip>
          <div className="flex min-w-0 flex-1 flex-col">
            <TitleEditor title={production.title} onSave={(title) => void persist(() => productionsApi.update(production.id, { title })).catch(() => undefined)} />
            <div className="flex items-center gap-3 px-1.5">
              <Badge variant={statusBadge.variant} dot>
                {rendering ? "Rendu en cours" : statusBadge.label}
              </Badge>
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {formatSeconds(total)} · {production.clips.length} clips × {production.clipDuration} s · 9:16
              </span>
              <SaveIndicator state={saveState} />
            </div>
          </div>
          <Button variant="outline" size="sm" className="hidden xl:inline-flex" onClick={() => setExportOpen(true)}>
            <FolderOutput /> Références Flow
          </Button>
          <CopyButton
            variant="outline"
            size="sm"
            className="hidden xl:inline-flex"
            text={allPromptsText(production)}
            label="Copier tous les prompts"
            toastMessage="Tous les prompts ont été copiés"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download /> Exporter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuLabel>Exporter</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                <FolderOutput /> Références visuelles pour Flow…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void copyToClipboard(allPromptsText(production))
                    .then(() => notifySuccess("Tous les prompts ont été copiés"))
                    .catch((e) => notifyError(e, "Copie impossible"))
                }
              >
                <Copy /> Copier tous les prompts
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportDocument("txt")}>
                <FileText /> Prompts Google Flow (.txt)…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportDocument("md")}>
                <FileText /> Dossier de production (.md)…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!production.finalVideo?.fileExists} onSelect={() => production.finalVideo && systemApi.reveal(production.finalVideo.filePath).catch((e) => notifyError(e))}>
                <FileVideo /> Afficher la vidéo finale
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Plus d'actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              <DropdownMenuItem onSelect={() => void pickMany()}>
                <FileVideo /> Importer plusieurs vidéos…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void confirmStoryRegeneration()}>
                <Sparkles /> Régénérer toute l'histoire…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => void remove()} disabled={rendering}>
                <Trash2 /> Supprimer la production…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => document.getElementById("render")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <Clapperboard /> Rendu final
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-8 py-6 xl:px-10">
        {production.clips.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Cette production n'a pas encore d'histoire"
            description="Générez une histoire avec les personnages sélectionnés."
            action={
              <Button onClick={() => void confirmStoryRegeneration()}>
                <Sparkles /> Générer l'histoire
              </Button>
            }
          />
        ) : (
          <>
            <ProgressStrip production={production} />
            <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-5">
                {production.clips.map((clip) => {
                  const content = parseClipContent(clip.content);
                  return (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      production={production}
                      busy={busyClip === clip.id}
                      regenerating={clipGeneration.running && regenClip?.id === clip.id}
                      onImport={() => void pickFor(clip)}
                      onDropFile={(path) => void importFor(clip, path)}
                      onRemoveVideo={() => void removeFrom(clip)}
                      onEdit={() => content && setEditingClip(clip)}
                      onRegenerate={() => {
                        clipGeneration.clearError();
                        setRegenClip(clip);
                      }}
                      onSavePrompt={(flowPrompt) => persist(() => productionsApi.updateClip(clip.id, { flowPrompt, promptEdited: true }))}
                      onResetPrompt={async () => {
                        if (!content) return;
                        await persist(() =>
                          productionsApi.updateClip(clip.id, { flowPrompt: recomposePrompt(production, content, library ?? []), promptEdited: false }),
                        );
                      }}
                    />
                  );
                })}
              </div>
              <aside className="flex flex-col gap-5 xl:sticky xl:top-[88px] xl:max-h-[calc(100vh-104px)] xl:self-start xl:overflow-y-auto xl:pb-2">
                <RenderPanel production={production} />
                <StoryOverview production={production} onSave={saveStory} />
              </aside>
            </div>
          </>
        )}
      </div>

      {editingClip && parseClipContent(editingClip.content) && (
        <ClipEditDialog
          clip={editingClip}
          content={parseClipContent(editingClip.content)!}
          production={production}
          onClose={() => setEditingClip(null)}
          onSave={(content) => saveClipContent(editingClip, content)}
        />
      )}
      {regenClip && (
        <RegenerateClipDialog
          clip={regenClip}
          generation={clipGeneration}
          onClose={() => {
            clipGeneration.cancel();
            setRegenClip(null);
          }}
          onRegenerate={(instruction) => void runClipRegeneration(regenClip, instruction)}
        />
      )}
      {bulkPaths && (
        <BulkImportDialog
          paths={bulkPaths.filter((p) => VIDEO_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? ""))}
          clips={production.clips}
          onClose={() => setBulkPaths(null)}
          onConfirm={async (assignments) => {
            for (const { clip, path } of assignments) await importFor(clip, path, { skipChecks: true });
          }}
        />
      )}
      <Dialog open={storyRegenOpen} onOpenChange={(o) => !o && !storyGeneration.running && setStoryRegenOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nouvelle histoire</DialogTitle>
            <DialogDescription>Mêmes personnages et paramètres, histoire entièrement nouvelle.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {storyGeneration.running && <GenerationProgress phase={storyGeneration.phase} elapsed={storyGeneration.elapsed} onCancel={storyGeneration.cancel} />}
            {storyGeneration.error && <GenerationErrorNotice error={storyGeneration.error} onRetry={() => void runStoryRegeneration()} onDismiss={() => setStoryRegenOpen(false)} />}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ExportReferencesDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        characterIds={production.characters.map((c) => c.id)}
        title={production.title}
        notes={allPromptsText(production)}
      />
    </div>
  );
}
