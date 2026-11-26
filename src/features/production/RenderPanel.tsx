import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, Circle, Clapperboard, Copy, FolderOpen, Music2, Play, Square, TerminalSquare } from "lucide-react";
import { copyToClipboard } from "@/components/common/CopyButton";
import { LocalVideo } from "@/components/common/media";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, Progress } from "@/components/ui/display";
import { Field, Input, Slider, Switch } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { invalidate, useFfmpeg, useMedia, useSettings } from "@/hooks/queries";
import { DEFAULT_RENDER_OPTIONS } from "@/services/ffmpeg";
import { FfmpegInstallButton } from "@/features/setup/FfmpegInstaller";
import { mediaApi } from "@/services/storage/media";
import { systemApi } from "@/services/storage/system";
import type { FitMode, ProductionDetail, RenderOptions } from "@/types";
import { AUDIO_EXTENSIONS } from "@/utils/clips";
import { FIT_MODES, FRAME_RATES, RESOLUTIONS, TRANSITIONS } from "@/utils/catalog";
import { cn } from "@/utils/cn";
import { formatBytes, formatDurationMs } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";
import { productionProgress } from "@/utils/status";
import { STAGE_LABEL, cancelRender, onRenderSettled, startRender, useRenderState } from "./renderStore";

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function RenderPanel({ production }: { production: ProductionDetail }) {
  const client = useQueryClient();
  const { data: settings } = useSettings();
  const { data: ffmpeg } = useFfmpeg();
  const music = useMedia("music", "");
  const render = useRenderState();
  const progress = productionProgress(production);

  const [opts, setOpts] = useState<RenderOptions | null>(null);

  // Reglages : ceux du dernier rendu de cette production, sinon les valeurs par defaut.
  useEffect(() => {
    if (!settings || opts) return;
    const saved = production.renderSettings;
    setOpts({
      ...DEFAULT_RENDER_OPTIONS,
      outputDir: settings.exportDir,
      fileName: production.title,
      width: settings.videoWidth,
      height: settings.videoHeight,
      fps: settings.frameRate,
      ...saved,
    } as RenderOptions);
  }, [settings, production, opts]);

  useEffect(
    () =>
      onRenderSettled((id) => {
        if (id === production.id) invalidate(client, "production", "productions", "media", "stats");
      }),
    [client, production.id],
  );

  const mine = render.productionId === production.id;
  const otherRunning = render.running && !mine;
  const finalVideo = production.finalVideo;
  const ffmpegReady = Boolean(ffmpeg?.found && ffmpeg.h264Encoder);
  const canRender = Boolean(opts) && progress.allImported && ffmpegReady && !render.running;

  const resolutionValue = useMemo(() => (opts ? `${opts.width}x${opts.height}` : ""), [opts]);
  if (!opts) return <Card className="h-64 p-5" />;
  const set = <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) => setOpts((o) => (o ? { ...o, [key]: value } : o));

  const importMusic = async () => {
    const selected = await openDialog({ multiple: false, filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }], title: "Musique de fond" });
    if (typeof selected !== "string") return;
    try {
      const report = await mediaApi.importAudio([selected], "music");
      invalidate(client, "media");
      if (report.imported[0]) set("musicAssetId", report.imported[0].id);
      for (const f of report.failures) notifyError(new Error(f.message), "Import impossible");
    } catch (e) {
      notifyError(e, "Import impossible");
    }
  };

  const launch = () => {
    try {
      startRender(production.id, opts);
    } catch (e) {
      notifyError(e, "Rendu impossible");
    }
  };

  return (
    <Card id="render" className="flex scroll-mt-24 flex-col gap-5 p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13.5px] font-semibold">Rendu final</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          MP4 · H.264 · AAC · {opts.width}×{opts.height} · {opts.fps} i/s
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {production.clips.map((clip) => {
          const ok = Boolean(clip.video?.fileExists);
          return (
            <li key={clip.id}>
              <a href={`#clip-${clip.clipNumber}`} onClick={(e) => { e.preventDefault(); document.getElementById(`clip-${clip.clipNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] transition-colors hover:bg-accent/60">
                {ok ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                <span className="font-medium">Clip {clip.clipNumber}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{ok ? clip.video!.originalName : "Vidéo manquante"}</span>
                {ok && <span className="font-mono text-[11px] text-muted-foreground">{formatDurationMs(clip.video!.durationMs)}</span>}
              </a>
            </li>
          );
        })}
      </ul>

      {!progress.allImported && (
        <InlineNotice tone="warning" icon={AlertTriangle} title={`Il manque ${progress.missing.length} vidéo(s)`}>
          Clip(s) {progress.missing.join(", ")} : importez la vidéo générée par Flow sur la carte correspondante.
        </InlineNotice>
      )}
      {ffmpeg && !ffmpegReady && (
        <div className="flex flex-col gap-3 rounded-lg border border-orange/30 bg-orange-soft p-3.5">
          <div className="flex items-start gap-2.5">
            <TerminalSquare className="mt-0.5 size-4 shrink-0 text-orange" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium">FFmpeg est nécessaire pour le rendu</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                Installation automatique en un clic : téléchargement vérifié (SHA-256), sans droits administrateur.{" "}
                <Link className="text-primary-strong hover:underline" to="/settings#video">
                  Autres options
                </Link>
              </p>
            </div>
          </div>
          <FfmpegInstallButton />
        </div>
      )}
      {progress.renderOutdated && finalVideo && !render.running && (
        <InlineNotice tone="warning" icon={AlertTriangle}>Des vidéos ont changé depuis le dernier rendu : relancez-le.</InlineNotice>
      )}

      <details className="group rounded-lg border border-border">
        <summary className="flex cursor-pointer flex-col px-3.5 py-2.5 text-[12.5px] font-medium select-none">
          Réglages du rendu
          <span className="text-[11.5px] font-normal text-muted-foreground group-open:hidden">Cadrage, transitions, volume, musique de fond</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-3.5">
          <Field label="Dossier de sortie">
            <div className="flex gap-2">
              <Input value={opts.outputDir} onChange={(e) => set("outputDir", e.target.value)} className="text-[12.5px]" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Choisir le dossier"
                onClick={async () => {
                  const dir = await openDialog({ directory: true, defaultPath: opts.outputDir || undefined });
                  if (typeof dir === "string") set("outputDir", dir);
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
          <Field label="Nom du fichier" hint="« .mp4 » est ajouté automatiquement ; un fichier existant n'est jamais écrasé.">
            <Input value={opts.fileName} onChange={(e) => set("fileName", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Résolution">
              <Select
                value={resolutionValue}
                onValueChange={(v) => {
                  const [w, h] = v.split("x").map(Number);
                  setOpts((o) => (o ? { ...o, width: w, height: h } : o));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOLUTIONS.map((r) => (
                    <SelectItem key={r.label} value={`${r.width}x${r.height}`}>
                      {r.width} × {r.height}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Images/s">
              <Select value={String(opts.fps)} onValueChange={(v) => set("fps", Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FRAME_RATES.map((f) => (
                    <SelectItem key={f} value={String(f)}>
                      {f} i/s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Cadrage si une vidéo n'est pas en 9:16">
            <Select value={opts.fitMode} onValueChange={(v) => set("fitMode", v as FitMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value} hint={m.hint}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Transition entre les clips">
            <Select value={opts.transition} onValueChange={(v) => set("transition", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSITIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {opts.transition !== "none" && (
            <SettingRow label={`Durée de transition : ${opts.transitionDuration.toFixed(1)} s`} hint="Raccourcit légèrement la vidéo.">
              <Slider className="w-32" min={0.2} max={1.5} step={0.1} value={[opts.transitionDuration]} onValueChange={([v]) => set("transitionDuration", v)} />
            </SettingRow>
          )}
          <SettingRow label="Normaliser le volume" hint="Niveau homogène (-14 LUFS) adapté à TikTok.">
            <Switch checked={opts.normalizeAudio} onCheckedChange={(v) => set("normalizeAudio", v)} />
          </SettingRow>
          <SettingRow label={`Volume des clips : ${Math.round(opts.clipVolume * 100)} %`}>
            <Slider className="w-32" min={0} max={2} step={0.05} value={[opts.clipVolume]} onValueChange={([v]) => set("clipVolume", v)} />
          </SettingRow>

          <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Music2 className="size-4 text-muted-foreground" /> Musique de fond (facultatif)
            </div>
            <div className="flex gap-2">
              <Select value={opts.musicAssetId ?? "none"} onValueChange={(v) => set("musicAssetId", v === "none" ? null : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucune</SelectItem>
                  {(music.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id} hint={formatDurationMs(m.durationMs)}>
                      {m.originalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void importMusic()}>
                Importer…
              </Button>
            </div>
            {opts.musicAssetId && (
              <>
                <SettingRow label={`Volume de la musique : ${Math.round(opts.musicVolume * 100)} %`}>
                  <Slider className="w-32" min={0} max={1} step={0.05} value={[opts.musicVolume]} onValueChange={([v]) => set("musicVolume", v)} />
                </SettingRow>
                <SettingRow label="Atténuer sous les dialogues" hint="Préserve l'intelligibilité des voix.">
                  <Switch checked={opts.musicDucking} onCheckedChange={(v) => set("musicDucking", v)} />
                </SettingRow>
                <SettingRow label="Fondu de fin">
                  <Switch checked={opts.musicFadeOut} onCheckedChange={(v) => set("musicFadeOut", v)} />
                </SettingRow>
              </>
            )}
          </div>
        </div>
      </details>

      {mine && render.running ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-primary/30 bg-lime-soft p-3.5" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-medium">{render.stage ? STAGE_LABEL[render.stage] : "Rendu"} — {render.message}</span>
            <span className="font-mono">{Math.round(render.percent)} %</span>
          </div>
          <Progress value={render.percent} />
          <Button variant="ghost" size="xs" className="self-end" onClick={() => void cancelRender()}>
            <Square /> Annuler
          </Button>
        </div>
      ) : (
        <Button size="lg" className="w-full" disabled={!canRender} onClick={launch}>
          <Clapperboard /> {finalVideo ? "Relancer le rendu final" : "Rendu de la vidéo finale"}
        </Button>
      )}
      {otherRunning && <p className="-mt-2 text-center text-[11.5px] text-muted-foreground">Un autre rendu est en cours.</p>}
      {mine && !render.running && render.stage === "error" && render.error && (
        <InlineNotice tone="danger" icon={AlertTriangle} title="Le rendu a échoué">
          <pre className="font-mono text-[11px] whitespace-pre-wrap" data-selectable>
            {render.error}
          </pre>
        </InlineNotice>
      )}
      {mine && !render.running && render.stage === "done" && render.result?.warnings.map((w) => (
        <InlineNotice key={w} tone="warning" icon={AlertTriangle}>{w}</InlineNotice>
      ))}

      {finalVideo && !(mine && render.running) && (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            <p className="text-[13px] font-semibold">Vidéo finale</p>
            {mine && render.result && (
              <span className="text-[11.5px] text-muted-foreground">
                · {render.result.strategy === "copy" ? "assemblée sans réencodage vidéo" : "normalisée et encodée"}
              </span>
            )}
          </div>
          {finalVideo.fileExists ? (
            <LocalVideo path={finalVideo.filePath} poster={finalVideo.thumbnailPath} className="mx-auto aspect-[9/16] max-h-[460px] rounded-lg object-contain" />
          ) : (
            <InlineNotice tone="warning" icon={AlertTriangle}>Le fichier rendu a été déplacé ou supprimé.</InlineNotice>
          )}
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={finalVideo.filePath} data-selectable>
            {finalVideo.filePath}
          </p>
          <p className="text-[11.5px] text-muted-foreground">
            {formatDurationMs(finalVideo.durationMs)} · {finalVideo.width}×{finalVideo.height} · {formatBytes(finalVideo.sizeBytes)}
          </p>
          <div className={cn("grid grid-cols-3 gap-2", !finalVideo.fileExists && "pointer-events-none opacity-50")}>
            <Button variant="outline" size="sm" onClick={() => systemApi.open(finalVideo.filePath).catch((e) => notifyError(e))}>
              <Play /> Lire
            </Button>
            <Button variant="outline" size="sm" onClick={() => systemApi.reveal(finalVideo.filePath).catch((e) => notifyError(e))}>
              <FolderOpen /> Dossier
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(finalVideo.filePath).then(() => notifySuccess("Chemin copié"))}
            >
              <Copy /> Chemin
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
