import { useCallback, useEffect, useRef, useState } from "react";
import { GeminiError, toGeminiError } from "@/services/gemini/errors";
import type { GenerationPhase } from "@/services/gemini/generator";

export interface GenerationState {
  running: boolean;
  phase: GenerationPhase | null;
  elapsed: number;
  error: GeminiError | null;
}

/** Gere une generation Gemini : phase, chronometre, annulation et erreur. */
export function useGeneration() {
  const [state, setState] = useState<GenerationState>({ running: false, phase: null, elapsed: 0, error: null });
  const controller = useRef<AbortController | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setState((s) => ({ ...s, elapsed: Math.floor((Date.now() - started.current) / 1000) })), 500);
    return () => clearInterval(t);
  }, [state.running]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async <T,>(task: (ctx: { signal: AbortSignal; onPhase: (p: GenerationPhase) => void }) => Promise<T>): Promise<T | null> => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    started.current = Date.now();
    setState({ running: true, phase: "writing", elapsed: 0, error: null });
    try {
      const result = await task({ signal: ctrl.signal, onPhase: (phase) => setState((s) => ({ ...s, phase })) });
      if (ctrl.signal.aborted) return null;
      setState({ running: false, phase: null, elapsed: 0, error: null });
      return result;
    } catch (error) {
      const e = toGeminiError(error);
      setState({ running: false, phase: null, elapsed: 0, error: e.code === "cancelled" ? null : e });
      if (e.code !== "cancelled") throw e;
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState({ running: false, phase: null, elapsed: 0, error: null });
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, run, cancel, clearError };
}

export const PHASE_LABEL: Record<GenerationPhase, string> = {
  writing: "Gemini écrit votre histoire…",
  repairing: "Correction automatique de la réponse…",
  finalizing: "Préparation des prompts Google Flow…",
};
