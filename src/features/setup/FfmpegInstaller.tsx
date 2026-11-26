import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FlaskConical, FolderOpen, RotateCw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge, Progress, Skeleton } from "@/components/ui/display";
import { qk, useFfmpeg } from "@/hooks/queries";
import { FFMPEG_DOWNLOAD_SIZE_LABEL, FFMPEG_INSTALL_COMMAND, ffmpegApi } from "@/services/ffmpeg";
import { errorMessage } from "@/services/storage/invoke";
import { systemApi } from "@/services/storage/system";
import type { FfmpegSelfTestResult } from "@/types";
import { cn } from "@/utils/cn";
import { formatBytes } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";
import { INSTALL_STAGE_LABEL, cancelFfmpegInstall, startFfmpegInstall, useFfmpegInstall } from "./ffmpegInstallStore";

export const FFMPEG_SOURCE_LABEL: Record<string, string> = {
  managed: "Installé par Fruity Studio",
  custom: "Chemin personnalisé",
  bundled: "Dossier de l'application",
  path: "PATH Windows",
  winget: "WinGet",
  scoop: "Scoop",
  chocolatey: "Chocolatey",
  common: "Emplacement standard",
};

/** « 9.0.2-essentials_build-www.gyan.dev » -> « 9.0.2 » */
function shortVersion(version: string | null): string {
  return version?.split("-")[0] ?? "";
}

/** Progression de l'installation (partagee par toutes les variantes). */
function InstallProgressBlock() {
  const install = useFfmpegInstall();
  const downloading = install.stage === "downloading" || install.stage === "checking";
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-primary/30 bg-lime-soft p-3.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[12.5px]">
        <span className="font-medium">{install.stage ? INSTALL_STAGE_LABEL[install.stage] : "Installation"}…</span>
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {install.stage === "downloading" && install.total
            ? `${formatBytes(install.downloaded)} / ${formatBytes(install.total)} · ${Math.round(install.percent)} %`
            : install.stage === "downloading"
              ? formatBytes(install.downloaded)
              : ""}
        </span>
      </div>
      <Progress value={install.stage === "downloading" ? install.percent : install.stage === "checking" ? 2 : 100} className={cn(!downloading && "[&>div]:animate-pulse")} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">{install.message}</span>
        {downloading && (
          <Button variant="ghost" size="xs" onClick={() => void cancelFfmpegInstall()}>
            <Square /> Annuler
          </Button>
        )}
      </div>
    </div>
  );
}

/** Bouton seul + progression : pour le panneau de rendu ou le tableau de bord. */
export function FfmpegInstallButton({ className, label = "Installer FFmpeg automatiquement" }: { className?: string; label?: string }) {
  const install = useFfmpegInstall();
  const { data: info } = useFfmpeg();
  if (install.running) return <InstallProgressBlock />;
  if (info && !info.canAutoInstall) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {install.stage === "error" && install.error && (
        <p className="text-[12px] leading-relaxed text-destructive" data-selectable>
          {install.error}
        </p>
      )}
      <Button onClick={startFfmpegInstall}>
        {install.stage === "error" ? <RotateCw /> : <Download />}
        {install.stage === "error" ? "Réessayer l'installation" : info?.managedInstalled ? "Réinstaller FFmpeg" : label}
      </Button>
    </div>
  );
}

/** Carte complete : etat, installation en un clic, autotest, desinstallation. */
export function FfmpegInstaller({ showManual = true }: { showManual?: boolean }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const { data: info, isLoading } = useFfmpeg();
  const install = useFfmpegInstall();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<FfmpegSelfTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [checking, setChecking] = useState(false);

  if (isLoading || !info) return <Skeleton className="h-24 rounded-lg" />;

  const recheck = async () => {
    setChecking(true);
    try {
      client.setQueryData(qk.ffmpeg, await ffmpegApi.detect(true));
    } catch (e) {
      notifyError(e, "Détection impossible");
    } finally {
      setChecking(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setTestError(null);
    try {
      setTest(await ffmpegApi.selfTest());
    } catch (e) {
      setTestError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const uninstall = async () => {
    const ok = await confirm({
      title: "Désinstaller FFmpeg ?",
      description: "La copie installée par Fruity Studio sera supprimée. Le rendu vidéo ne fonctionnera plus jusqu'à une nouvelle installation.",
      confirmLabel: "Désinstaller",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      client.setQueryData(qk.ffmpeg, await ffmpegApi.uninstall());
      setTest(null);
      notifySuccess("FFmpeg désinstallé");
    } catch (e) {
      notifyError(e, "Désinstallation impossible");
    } finally {
      setRemoving(false);
    }
  };

  const ready = info.found && Boolean(info.h264Encoder) && info.hasAac;
  const installedButNotStarting = !info.found && info.managedInstalled;

  return (
    <div className="flex flex-col gap-3">
      {install.running ? (
        <InstallProgressBlock />
      ) : ready ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-success/30 bg-success/8 p-3.5 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="size-4 text-success" />
            <span className="font-medium">FFmpeg {shortVersion(info.version)} prêt</span>
            <Badge variant="outline">{FFMPEG_SOURCE_LABEL[info.source ?? ""] ?? info.source}</Badge>
            {info.h264Encoder && <Badge variant="lime">{info.h264Encoder}</Badge>}
            {info.hasAac && <Badge variant="lime">aac</Badge>}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={info.ffmpegPath ?? ""} data-selectable>
            {info.ffmpegPath}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="xs" onClick={() => void runTest()} loading={testing}>
              <FlaskConical /> Tester l'encodage
            </Button>
            {info.source === "managed" && info.managedDir && (
              <>
                <Button variant="ghost" size="xs" onClick={() => systemApi.reveal(info.managedDir!).catch((e) => notifyError(e))}>
                  <FolderOpen /> Dossier
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void uninstall()} loading={removing}>
                  <Trash2 /> Désinstaller
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {installedButNotStarting ? "FFmpeg est installé mais ne répond pas" : info.found ? "FFmpeg incomplet" : "FFmpeg n'est pas installé"}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground" data-selectable>
                {info.error ? `${info.error} ` : ""}Nécessaire pour analyser les clips et assembler la vidéo finale.
              </p>
            </div>
          </div>
          {installedButNotStarting && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void recheck()} loading={checking}>
                {!checking && <RotateCw />} Relancer la détection
              </Button>
              <Button variant="outline" onClick={startFfmpegInstall} disabled={checking}>
                <Download /> Réinstaller
              </Button>
            </div>
          )}
          {info.canAutoInstall && !installedButNotStarting && (
            <>
              <ul className="flex flex-col gap-1 pl-7 text-[12px] text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-success" /> Builds Windows de gyan.dev, référencés par ffmpeg.org ({FFMPEG_DOWNLOAD_SIZE_LABEL})
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-success" /> Empreinte SHA-256 vérifiée avant installation
                </li>
                <li className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-success" /> Installé dans le dossier de Fruity Studio : ni droits administrateur, ni modification de Windows
                </li>
              </ul>
              {install.stage === "error" && install.error && (
                <InlineNotice tone="danger" icon={AlertTriangle} title="L'installation a échoué">
                  <span data-selectable>{install.error}</span>
                </InlineNotice>
              )}
              {install.stage === "cancelled" && <p className="pl-7 text-[12px] text-muted-foreground">Installation annulée.</p>}
              <Button size="lg" className="self-start" onClick={startFfmpegInstall}>
                {install.stage === "error" ? <RotateCw /> : <Download />}
                {install.stage === "error" ? "Réessayer l'installation" : "Installer FFmpeg automatiquement"}
              </Button>
            </>
          )}
        </div>
      )}

      {install.stage === "done" && !install.running && ready && (
        <InlineNotice tone="success" icon={CheckCircle2}>
          Installation terminée : FFmpeg {shortVersion(install.version ?? info.version)} a été téléchargé, vérifié et testé.
        </InlineNotice>
      )}
      {test && (
        <InlineNotice tone="success" icon={FlaskConical} title="Encodage vérifié">
          Vidéo de test {test.width}×{test.height} en {test.videoCodec?.toUpperCase()} + {test.audioCodec?.toUpperCase()} encodée en{" "}
          {(test.elapsedMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s avec {test.encoder}.
        </InlineNotice>
      )}
      {testError && (
        <InlineNotice tone="danger" icon={AlertTriangle} title="Le test d'encodage a échoué">
          <span className="font-mono text-[11.5px]" data-selectable>
            {testError}
          </span>
        </InlineNotice>
      )}

      {showManual && !ready && (
        <details className="text-[12px] text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Installation manuelle (alternative)</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>Dans PowerShell :</span>
            <code className="rounded border border-border bg-background px-2 py-1 font-mono text-[11.5px] text-foreground" data-selectable>
              {FFMPEG_INSTALL_COMMAND}
            </code>
            <CopyButton text={FFMPEG_INSTALL_COMMAND} size="xs" variant="outline" />
            <span>puis relancez la détection.</span>
          </div>
        </details>
      )}
    </div>
  );
}
