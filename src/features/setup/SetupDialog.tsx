import { useState, type ReactNode } from "react";
import { ArrowRight, Check, Clapperboard, KeyRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/form-controls";
import { useFfmpeg, useKeyStatus } from "@/hooks/queries";
import { cn } from "@/utils/cn";
import { FfmpegInstaller } from "./FfmpegInstaller";
import { useFfmpegInstall } from "./ffmpegInstallStore";
import { GeminiKeyForm } from "./GeminiKeyForm";
import { closeSetup, setSetupHiddenAtStartup, setupHiddenAtStartup, useSetupOpen } from "./setupStore";

function SetupStep({
  index,
  icon: Icon,
  title,
  description,
  done,
  children,
}: {
  index: number;
  icon: LucideIcon;
  title: string;
  description: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border p-5 transition-colors", done ? "border-success/30" : "border-border bg-card")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border",
            done ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-surface text-primary-strong",
          )}
        >
          {done ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">Étape {index}</span>
            <h3 className="text-[14px] font-semibold">{title}</h3>
            <Badge variant={done ? "success" : "orange"} dot>
              {done ? "Prêt" : "À faire"}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Assistant de configuration : s'ouvre au lancement tant que la clé Gemini ou
 * FFmpeg manque. Réouvrable depuis la barre latérale (statuts Gemini / FFmpeg).
 */
export function SetupDialog() {
  const open = useSetupOpen();
  const { data: key } = useKeyStatus();
  const { data: ffmpeg } = useFfmpeg();
  const install = useFfmpegInstall();
  const [hideAtStartup, setHideAtStartup] = useState(setupHiddenAtStartup);

  const keyReady = Boolean(key?.configured);
  const ffmpegReady = Boolean(ffmpeg?.found && ffmpeg.h264Encoder && ffmpeg.hasAac);
  const allReady = keyReady && ffmpegReady;

  const close = () => {
    setSetupHiddenAtStartup(hideAtStartup);
    closeSetup();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3.5">
          <BrandMark size={40} />
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-[17px]">Bienvenue dans Fruity Studio</DialogTitle>
            <DialogDescription>
              Deux réglages et vous êtes prêt à tourner. Tout reste modifiable dans Paramètres.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SetupStep
            index={1}
            icon={KeyRound}
            title="Clé API Gemini"
            description="Gemini écrit les histoires et les prompts Google Flow. La clé est gratuite : créez-la sur Google AI Studio, collez-la ici, Fruity Studio l'enregistre et la teste."
            done={keyReady}
          >
            <GeminiKeyForm autoFocus={!keyReady} />
          </SetupStep>
          <SetupStep
            index={2}
            icon={Clapperboard}
            title="FFmpeg (assemblage vidéo)"
            description="Analyse les clips importés et assemble la vidéo TikTok finale. Un clic suffit : téléchargement, vérification et installation sont automatiques."
            done={ffmpegReady}
          >
            <FfmpegInstaller showManual={false} />
          </SetupStep>
        </DialogBody>
        <DialogFooter className="justify-between">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Checkbox checked={hideAtStartup} onCheckedChange={(v) => setHideAtStartup(v === true)} />
            Ne plus afficher au démarrage
          </label>
          {allReady ? (
            <Button onClick={close}>
              C'est parti <ArrowRight />
            </Button>
          ) : install.running ? (
            <Button variant="outline" onClick={close}>
              Continuer (l'installation se poursuit) <ArrowRight />
            </Button>
          ) : (
            <Button variant="outline" onClick={close}>
              Plus tard
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
