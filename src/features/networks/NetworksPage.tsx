import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, Lightbulb, PanelRightClose, PanelRightOpen, RefreshCw, RotateCw, Sparkles } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { EmptyState, InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui/display";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { openSetup } from "@/features/setup/setupStore";
import { GenerationErrorNotice, GenerationProgress } from "@/features/stories/GenerationStatus";
import { useGeneration } from "@/features/stories/useGeneration";
import { invalidate, useKeyStatus, useProductions, useSettings } from "@/hooks/queries";
import { generatePublishKit, type GenerationPhase } from "@/services/gemini/generator";
import { errorMessage } from "@/services/storage/invoke";
import { networksApi, type NetworkId } from "@/services/storage/networks";
import { productionsApi } from "@/services/storage/productions";
import { systemApi } from "@/services/storage/system";
import { notifyError } from "@/utils/notify";

const NETWORK_LABEL: Record<NetworkId, string> = { tiktok: "TikTok", youtube: "YouTube" };

const PUBLISH_PHASE_LABEL: Record<GenerationPhase, string> = {
  writing: "Gemini écrit votre texte de publication…",
  repairing: "Correction automatique de la réponse…",
  finalizing: "Mise en forme du texte…",
};

/** Une vue native passe devant l'interface : on la masque quand une boite de dialogue s'ouvre. */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(document.querySelector('[role="dialog"], [role="alertdialog"]') !== null);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium">{label}</span>
        <CopyButton text={text} size="xs" variant="outline" aria-label={`Copier : ${label}`} />
      </div>
      <p className="rounded-lg border border-border bg-surface p-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap" data-selectable>
        {text}
      </p>
    </div>
  );
}

function PublishPanel({ network }: { network: NetworkId }) {
  const client = useQueryClient();
  const { data: productions, isLoading } = useProductions();
  const { data: settings } = useSettings();
  const { data: key } = useKeyStatus();
  const generation = useGeneration();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Les productions deja rendues d'abord : ce sont celles qu'on peut publier.
  const sorted = useMemo(() => [...(productions ?? [])].sort((a, b) => Number(Boolean(b.finalVideoPath)) - Number(Boolean(a.finalVideoPath))), [productions]);
  const production = sorted.find((p) => p.id === selectedId) ?? sorted[0] ?? null;
  const kit = production?.story.publishKit ?? null;

  if (isLoading) return <Skeleton className="m-4 h-40 rounded-lg" />;
  if (!production) {
    return (
      <div className="p-4">
        <EmptyState compact icon={Sparkles} title="Aucune production" description="Créez d'abord une production pour préparer sa publication." />
      </div>
    );
  }

  const write = async () => {
    if (!settings) return;
    if (key && !key.configured) {
      openSetup();
      return;
    }
    try {
      const saved = await generation.run(async ({ signal, onPhase }) => {
        const next = await generatePublishKit({ production, previous: kit, model: settings.geminiModel }, { signal, onPhase });
        await productionsApi.update(production.id, { story: { ...production.story, publishKit: next } });
        return next;
      });
      if (saved) invalidate(client, "productions", "production");
    } catch {
      // erreur affichee dans le panneau
    }
  };

  const videoPath = production.finalVideoPath;

  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-2.5">
        <h2 className="text-eyebrow">1. La vidéo</h2>
        <Select value={production.id} onValueChange={setSelectedId} disabled={generation.running}>
          <SelectTrigger aria-label="Production à publier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorted.map((p) => (
              <SelectItem key={p.id} value={p.id} hint={p.finalVideoPath ? "Vidéo prête" : "Pas encore rendue"}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {videoPath ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => systemApi.reveal(videoPath).catch((e) => notifyError(e))}>
                <FolderOpen /> Afficher le fichier
              </Button>
              <CopyButton text={videoPath} size="xs" variant="outline" label="Copier le chemin" />
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">Glissez le fichier sur le site, ou collez son chemin dans la fenêtre de choix de fichier.</p>
          </>
        ) : (
          <InlineNotice tone="warning">
            La vidéo finale n'est pas encore rendue.{" "}
            <Link to={`/productions/${production.id}`} className="text-primary-strong underline-offset-2 hover:underline">
              Ouvrir la production
            </Link>
          </InlineNotice>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-eyebrow">2. Le texte</h2>
        {generation.running ? (
          <GenerationProgress phase={generation.phase} elapsed={generation.elapsed} onCancel={generation.cancel} labels={PUBLISH_PHASE_LABEL} estimate="en général quelques secondes" />
        ) : generation.error ? (
          <GenerationErrorNotice error={generation.error} onRetry={() => void write()} onDismiss={generation.clearError} />
        ) : null}
        {kit ? (
          <>
            {network === "tiktok" ? (
              <CopyBlock label="Légende TikTok" text={kit.tiktok} />
            ) : (
              <>
                <CopyBlock label="Titre YouTube" text={kit.youtubeTitle} />
                <CopyBlock label="Description YouTube" text={kit.youtubeDescription} />
              </>
            )}
            <Button size="xs" variant="ghost" className="self-start" onClick={() => void write()} disabled={generation.running}>
              <RotateCw /> Autre proposition
            </Button>
          </>
        ) : (
          !generation.running && (
            <>
              <Button onClick={() => void write()}>
                <Sparkles /> Écrire le texte de publication
              </Button>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">Accroche, mots-clés et hashtags pensés pour toucher un maximum de personnes. Consomme 1 requête Gemini.</p>
            </>
          )
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-eyebrow">3. Publier</h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">Collez le texte sur le site, puis cliquez sur Publier.</p>
        {network === "tiktok" && <InlineNotice icon={Lightbulb}>Activez « Contenu généré par l'IA » dans les options de publication.</InlineNotice>}
      </section>
    </div>
  );
}

/** TikTok et YouTube dans l'application, a cote du texte a copier. */
export function NetworksPage() {
  const [network, setNetwork] = useState<NetworkId>("tiktok");
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const modalOpen = useModalOpen();

  // La vue native suit l'emplacement reserve dans la page.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || modalOpen) {
      void networksApi.hideAll().catch(() => undefined);
      return;
    }
    setError(null);
    let shown = false;
    const update = () => {
      const rect = area.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const call = shown ? networksApi.setBounds(network, bounds) : networksApi.show(network, bounds);
      shown = true;
      call.catch((e) => setError(errorMessage(e)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [network, modalOpen]);

  useEffect(
    () => () => {
      void networksApi.hideAll().catch(() => undefined);
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Tabs value={network} onValueChange={(v) => setNetwork(v as NetworkId)}>
          <TabsList>
            <TabsTrigger value="tiktok">TikTok</TabsTrigger>
            <TabsTrigger value="youtube">YouTube</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => networksApi.reload(network).catch((e) => notifyError(e))}>
            <RefreshCw /> Recharger
          </Button>
          <Button variant="ghost" size="xs" onClick={() => networksApi.openExternal(network).catch((e) => notifyError(e))}>
            <ExternalLink /> Ouvrir dans mon navigateur
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title={panelOpen ? "Masquer le panneau" : "Afficher le panneau"}
            aria-label={panelOpen ? "Masquer le panneau" : "Afficher le panneau"}
            onClick={() => setPanelOpen((o) => !o)}
          >
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={areaRef} className="flex min-w-0 flex-1 items-center justify-center bg-surface text-[12.5px] text-muted-foreground">
          {error ? (
            <span className="max-w-md px-6 text-center" data-selectable>
              {NETWORK_LABEL[network]} n'a pas pu s'ouvrir ici : {error}
            </span>
          ) : (
            `Chargement de ${NETWORK_LABEL[network]}…`
          )}
        </div>
        {panelOpen && (
          <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-border bg-sidebar">
            <PublishPanel network={network} />
          </aside>
        )}
      </div>
    </div>
  );
}
