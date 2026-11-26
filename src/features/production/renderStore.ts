/**
 * Etat global du rendu FFmpeg. Le rendu tourne cote Rust : cet etat survit a la
 * navigation (quitter l'espace de production ne l'interrompt pas).
 */
import { useSyncExternalStore } from "react";
import { ffmpegApi, onRenderProgress } from "@/services/ffmpeg";
import { toAppError } from "@/services/storage/invoke";
import type { RenderOptions, RenderResult, RenderStage } from "@/types";

export interface RenderState {
  running: boolean;
  productionId: string | null;
  stage: RenderStage | null;
  percent: number;
  message: string;
  result: RenderResult | null;
  error: string | null;
}

const initial: RenderState = { running: false, productionId: null, stage: null, percent: 0, message: "", result: null, error: null };
let state: RenderState = initial;
const listeners = new Set<() => void>();
const settledListeners = new Set<(productionId: string) => void>();

function set(patch: Partial<RenderState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let eventsReady = false;

/** A appeler une fois au demarrage : ecoute la progression emise par Rust. */
export function initRenderEvents() {
  if (eventsReady) return;
  eventsReady = true;
  void onRenderProgress((p) => {
    if (!state.running || p.productionId !== state.productionId) return;
    if (p.stage === "done" || p.stage === "error" || p.stage === "cancelled") return;
    set({ stage: p.stage, percent: p.percent, message: p.message });
  });
  // Rendu deja en cours (ex. rechargement de la fenetre) : on le signale.
  void ffmpegApi
    .status()
    .then((productionId) => {
      if (productionId && !state.running) {
        set({ ...initial, running: true, productionId, stage: "encoding", message: "Rendu en cours…" });
      }
    })
    .catch(() => undefined);
}

export function onRenderSettled(listener: (productionId: string) => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

export function startRender(productionId: string, options: RenderOptions) {
  if (state.running) throw new Error("Un rendu est déjà en cours.");
  set({ ...initial, running: true, productionId, stage: "preparing", message: "Préparation…" });
  ffmpegApi
    .render(productionId, options)
    .then((result) => set({ running: false, stage: "done", percent: 100, message: "Rendu terminé", result }))
    .catch((error) => {
      const e = toAppError(error);
      set({ running: false, stage: e.kind === "cancelled" ? "cancelled" : "error", percent: 0, error: e.kind === "cancelled" ? null : e.message, message: e.message });
    })
    .finally(() => {
      for (const l of settledListeners) l(productionId);
    });
}

export async function cancelRender() {
  await ffmpegApi.cancel();
}

export function resetRender(productionId: string) {
  if (!state.running && state.productionId === productionId) set(initial);
}

export function useRenderState(): RenderState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const STAGE_LABEL: Record<RenderStage, string> = {
  preparing: "Préparation",
  probing: "Analyse des clips",
  encoding: "Assemblage",
  finalizing: "Vérification",
  done: "Terminé",
  error: "Échec",
  cancelled: "Annulé",
};
