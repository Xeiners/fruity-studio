import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startDictation } from "@/services/speech/dictation";

/** Une seule dictee a la fois : en demarrer une termine la precedente. */
let stopCurrentDictation: (() => Promise<void>) | null = null;

export function joinDictation(base: string, committed: string, partial: string): string {
  return [base, committed, partial].filter(Boolean).join(" ");
}

function dictationErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotFoundError") return "Aucun micro n'a été trouvé sur cet ordinateur.";
  if (name === "NotAllowedError") return "Le micro est refusé. Autorisez-le dans la fenêtre qui s'affiche, ou dans Paramètres Windows › Confidentialité › Microphone.";
  if (name === "NotReadableError") return "Le micro est occupé par une autre application.";
  return "La reconnaissance vocale n'a pas pu démarrer.";
}

/** Bouton de dictee : le champ se remplit pendant que l'utilisateur parle. A placer dans `aside`. */
export function DictationButton({ value, onChange, disabled, field }: { value: string; onChange: (text: string) => void; disabled?: boolean; field: string }) {
  const [state, setState] = useState<"idle" | "starting" | "listening" | "finishing">("idle");
  const [seconds, setSeconds] = useState(0);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const stopRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(
    () => () => {
      void stopRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (state !== "listening") return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [state]);

  const start = async () => {
    setState("starting");
    await stopCurrentDictation?.();
    const base = latest.current.value.trimEnd();
    try {
      const stop = async () => {
        setState("finishing");
        await session.stop();
        if (stopCurrentDictation === stop) stopCurrentDictation = null;
        stopRef.current = null;
        setState("idle");
      };
      const session = await startDictation({
        onUpdate: (committed, partial) => latest.current.onChange(joinDictation(base, committed, partial)),
        onSilence: () => void stopRef.current?.(),
      });
      stopRef.current = stop;
      stopCurrentDictation = stop;
      setState("listening");
    } catch (error) {
      setState("idle");
      toast.error("Dictée impossible", { description: dictationErrorMessage(error) });
    }
  };

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (state === "listening" || state === "finishing") {
    return (
      <Button type="button" variant="destructive" size="xs" className="h-6" loading={state === "finishing"} onClick={() => void stopRef.current?.()} aria-label={`Arrêter la dictée : ${field}`}>
        {state === "listening" && <Square className="fill-current" />} Arrêter <span className="font-mono">{clock}</span>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="xs" className="h-6" onClick={() => void start()} disabled={disabled} loading={state === "starting"} aria-label={`Dicter : ${field}`}>
      {state === "starting" ? "Préparation…" : <><Mic /> Dicter</>}
    </Button>
  );
}
