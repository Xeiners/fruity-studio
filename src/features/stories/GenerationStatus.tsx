import { AlertTriangle, ExternalLink, RotateCw, Sparkles, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { GeminiError } from "@/services/gemini/errors";
import type { GenerationPhase } from "@/services/gemini/generator";
import { cn } from "@/utils/cn";
import { PHASE_LABEL } from "./useGeneration";

export function GenerationProgress({
  phase,
  elapsed,
  onCancel,
  className,
  labels = PHASE_LABEL,
  estimate = "une histoire complète prend en général 20 à 90 s",
}: {
  phase: GenerationPhase | null;
  elapsed: number;
  onCancel: () => void;
  className?: string;
  labels?: Record<GenerationPhase, string>;
  estimate?: string;
}) {
  const steps: GenerationPhase[] = ["writing", "repairing", "finalizing"];
  const index = phase ? steps.indexOf(phase) : 0;
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-primary/30 bg-lime-soft p-4 animate-fade-in", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="relative flex size-9 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
          <span className="relative flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{labels[phase ?? "writing"]}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {elapsed} s · {estimate}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Annuler la génération">
          <X />
        </Button>
      </div>
      <div className="flex gap-1">
        {steps.map((s, i) => (
          <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= index ? "bg-primary" : "bg-primary/20", i === index && "animate-pulse")} />
        ))}
      </div>
    </div>
  );
}

export function GenerationErrorNotice({ error, onRetry, onDismiss }: { error: GeminiError; onRetry?: () => void; onDismiss?: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/8 p-4 animate-fade-in" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{error.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground" data-selectable>
            {error.message}
          </p>
          {error.details && error.code === "invalid_output" && (
            <details className="mt-2 text-[11.5px] text-muted-foreground">
              <summary className="cursor-pointer">Détails techniques</summary>
              <pre className="mt-1 font-mono whitespace-pre-wrap" data-selectable>
                {error.details}
              </pre>
            </details>
          )}
        </div>
        {onDismiss && (
          <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Fermer">
            <X />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pl-7">
        {(error.code === "no_key" || error.code === "invalid_key" || error.code === "model_not_found" || error.code === "model_unsupported" || error.code === "permission") && (
          <Button asChild size="xs" variant="outline">
            <Link to="/settings#gemini">Ouvrir les paramètres Gemini</Link>
          </Button>
        )}
        {error.code === "quota" && (
          <Button size="xs" variant="outline" onClick={() => void openUrl("https://aistudio.google.com/rate-limit")}>
            <ExternalLink /> Voir mes quotas
          </Button>
        )}
        {onRetry && error.retryable && (
          <Button size="xs" onClick={onRetry}>
            <RotateCw /> Réessayer
          </Button>
        )}
      </div>
    </div>
  );
}
