import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, AudioLines, ExternalLink, Film, FolderOpen, Image as ImageIcon, Images, Music2, Search, Trash2, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { LocalImage, LocalVideo } from "@/components/common/media";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, GridSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge, Tabs, TabsList, TabsTrigger } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form-controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menus";
import { invalidate, useMedia } from "@/hooks/queries";
import { useDropZone } from "@/hooks/useFileDrop";
import { fileUrl, mediaApi } from "@/services/storage/media";
import { systemApi } from "@/services/storage/system";
import type { MediaItem, MediaKind } from "@/types";
import { angle } from "@/utils/catalog";
import { AUDIO_EXTENSIONS, hasExtension } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { formatBytes, formatDate, formatDurationMs, pluralize } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";

type Tab = "all" | "character_image" | "clip_video" | "render" | "audio" | "thumbnail";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "character_image", label: "Références" },
  { value: "clip_video", label: "Clips importés" },
  { value: "render", label: "Rendus finaux" },
  { value: "audio", label: "Musiques & SFX" },
  { value: "thumbnail", label: "Miniatures" },
];

const KIND_META: Record<MediaKind, { label: string; icon: LucideIcon }> = {
  character_image: { label: "Référence", icon: ImageIcon },
  clip_video: { label: "Clip", icon: Film },
  render: { label: "Rendu final", icon: Film },
  music: { label: "Musique", icon: Music2 },
  sfx: { label: "Effet sonore", icon: AudioLines },
  thumbnail: { label: "Miniature", icon: Images },
};

function subtitle(item: MediaItem): string {
  if (item.kind === "character_image") return `${item.characterName ?? "Personnage supprimé"} · ${angle(item.label).label}`;
  if (item.kind === "clip_video") return `${item.productionTitle ?? "Production supprimée"}${item.clipNumber ? ` · clip ${item.clipNumber}` : " · non associé"}`;
  if (item.kind === "render" || item.kind === "thumbnail") return item.productionTitle ?? "Production supprimée";
  return formatDurationMs(item.durationMs);
}

function Preview({ item }: { item: MediaItem }) {
  const Icon = KIND_META[item.kind].icon;
  if (!item.fileExists) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-surface text-[11.5px] text-warning">
        <AlertTriangle className="size-5" /> Fichier manquant
      </div>
    );
  }
  if (item.kind === "character_image" || item.kind === "thumbnail") {
    return <LocalImage path={item.filePath} alt={item.originalName} fit={item.kind === "character_image" ? "contain" : "cover"} className={cn("size-full", item.kind === "character_image" && "p-2 checker")} />;
  }
  if ((item.kind === "clip_video" || item.kind === "render") && item.thumbnailPath) {
    return <LocalImage path={item.thumbnailPath} alt={item.originalName} className="size-full" />;
  }
  return (
    <div className="flex size-full items-center justify-center bg-surface text-muted-foreground">
      <Icon className="size-8" strokeWidth={1.4} />
    </div>
  );
}

export function MediaLibraryPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const { data, isLoading, isError, error, refetch } = useMedia(null, query.trim());

  const items = useMemo(
    () =>
      (data ?? []).filter((m) => {
        if (tab === "all") return true;
        if (tab === "audio") return m.kind === "music" || m.kind === "sfx";
        return m.kind === tab;
      }),
    [data, tab],
  );
  const totalSize = items.filter((i) => i.kind !== "thumbnail").reduce((sum, i) => sum + i.sizeBytes, 0);

  const importAudio = async (kind: "music" | "sfx", paths?: string[]) => {
    let files = paths;
    if (!files) {
      const selected = await openDialog({ multiple: true, filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }], title: kind === "music" ? "Importer des musiques" : "Importer des effets sonores" });
      files = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    }
    if (!files.length) return;
    try {
      const report = await mediaApi.importAudio(files, kind);
      invalidate(client, "media");
      if (report.imported.length) notifySuccess(`${report.imported.length} fichier(s) audio importé(s)`);
      for (const f of report.failures) notifyError(new Error(f.message), "Fichier ignoré");
      setTab("audio");
    } catch (e) {
      notifyError(e, "Import impossible");
    }
  };

  const { dropProps, isOver } = useDropZone("library", {
    accept: (p) => hasExtension(p, AUDIO_EXTENSIONS),
    onDrop: (paths) => void importAudio("music", paths),
    label: "la médiathèque (musiques)",
    multiple: true,
  });

  const remove = async (item: MediaItem) => {
    const descriptions: Partial<Record<MediaKind, string>> = {
      character_image: `Cette image sera retirée de la galerie de ${item.characterName ?? "ce personnage"}.`,
      clip_video: item.clipNumber ? `Cette vidéo sera retirée du clip ${item.clipNumber} de « ${item.productionTitle} ».` : "La copie gérée de cette vidéo sera supprimée.",
      render: "La fiche du rendu est retirée de la médiathèque. Le fichier MP4 exporté reste sur votre disque.",
      music: "La copie gérée de ce fichier audio sera supprimée.",
      sfx: "La copie gérée de ce fichier audio sera supprimée.",
    };
    const ok = await confirm({ title: `Supprimer « ${item.originalName} » ?`, description: descriptions[item.kind], confirmLabel: "Supprimer", destructive: true });
    if (!ok) return;
    try {
      await mediaApi.remove(item.id);
      invalidate(client, "media", "character", "characters", "production", "productions", "stats");
      setPreview(null);
    } catch (e) {
      notifyError(e, "Suppression impossible");
    }
  };

  return (
    <Page wide>
      <PageHeader
        title="Médiathèque"
        description="Tous les fichiers gérés par Fruity Studio : références, clips importés, rendus finaux, musiques et miniatures. Les fichiers identiques ne sont stockés qu'une fois."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Upload /> Importer de l'audio
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => void importAudio("music")}>
                <Music2 /> Musiques de fond…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void importAudio("sfx")}>
                <AudioLines /> Effets sonores…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, personnage, production…" className="pl-9" />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {data && (
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {pluralize(items.length, "fichier")} · {formatBytes(totalSize)}
          </span>
        )}
      </div>

      <div {...dropProps} className={cn("rounded-xl transition-shadow", isOver && "ring-4 ring-primary/20")}>
        {isLoading ? (
          <GridSkeleton count={10} className="grid-cols-[repeat(auto-fill,minmax(170px,1fr))]" itemClassName="h-60" />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title={query ? "Aucun fichier ne correspond" : "Rien ici pour l'instant"}
            description={query ? "Essayez un autre terme." : "Les images de référence, les clips importés et les rendus apparaîtront ici. Vous pouvez aussi glisser des musiques sur cette zone."}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {items.map((item) => {
              const meta = KIND_META[item.kind];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreview(item)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-muted-foreground/35"
                >
                  <div className="relative aspect-[4/5] overflow-hidden border-b border-border">
                    <Preview item={item} />
                    <Badge variant="outline" className="absolute top-2 left-2 bg-popover/90 backdrop-blur">
                      <meta.icon /> {meta.label}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-0.5 p-2.5">
                    <p className="truncate text-[12.5px] font-medium" title={item.originalName}>
                      {item.originalName}
                    </p>
                    <p className="truncate text-[11.5px] text-muted-foreground">{subtitle(item)}</p>
                    <p className="font-mono text-[10.5px] text-muted-foreground/80">
                      {formatBytes(item.sizeBytes)}
                      {item.durationMs ? ` · ${formatDurationMs(item.durationMs)}` : ""}
                      {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate">{preview.originalName}</DialogTitle>
                <DialogDescription>
                  {KIND_META[preview.kind].label} · {subtitle(preview)} · ajouté le {formatDate(preview.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex items-center justify-center bg-surface-strong">
                {!preview.fileExists ? (
                  <p className="py-16 text-[13px] text-warning">Ce fichier n'existe plus à l'emplacement enregistré.</p>
                ) : preview.kind === "clip_video" || preview.kind === "render" ? (
                  <LocalVideo path={preview.filePath} poster={preview.thumbnailPath} autoPlay className="max-h-[62vh] rounded-lg" />
                ) : preview.kind === "music" || preview.kind === "sfx" ? (
                  <audio src={fileUrl(preview.filePath)} controls autoPlay className="w-full max-w-md py-10" />
                ) : (
                  <LocalImage path={preview.filePath} alt={preview.originalName} fit="contain" className="max-h-[62vh] w-full checker" />
                )}
              </DialogBody>
              <DialogFooter className="justify-between">
                <p className="max-w-[50%] truncate font-mono text-[11px] text-muted-foreground" title={preview.filePath} data-selectable>
                  {preview.filePath}
                </p>
                <div className="flex gap-2">
                  {preview.characterId && preview.kind === "character_image" && (
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/characters/${preview.characterId}`)}>
                      <ExternalLink /> Personnage
                    </Button>
                  )}
                  {preview.productionId && preview.kind !== "character_image" && preview.productionTitle && (
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/productions/${preview.productionId}`)}>
                      <ExternalLink /> Production
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={!preview.fileExists} onClick={() => systemApi.reveal(preview.filePath).catch((e) => notifyError(e))}>
                    <FolderOpen /> Explorateur
                  </Button>
                  {!(preview.kind === "thumbnail" && preview.parentId) && (
                    <Button variant="destructive" size="sm" onClick={() => void remove(preview)}>
                      <Trash2 /> Supprimer
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
