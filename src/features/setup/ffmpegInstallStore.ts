/**
 * Etat global de l'installation automatique de FFmpeg. L'installation tourne
 * cote Rust : quitter l'ecran ne l'interrompt pas.
 */
import { useSyncExternalStore } from "react";
import { qk } from "@/hooks/queries";
import { queryClient } from "@/hooks/queryClient";
import { ffmpegApi, onInstallProgress } from "@/services/ffmpeg";
import { toAppError } from "@/services/storage/invoke";
import type { FfmpegInstallStage } from "@/types";

export interface FfmpegInstallState {
  running: boolean;
  stage: FfmpegInstallStage | null;
  percent: number;
  downloaded: number;
  total: number | null;
  message: string;
  error: string | null;
  version: string | null;
}

const initial: FfmpegInstallState = {
  running: false,
  stage: null,
  percent: 0,
  downloaded: 0,
  total: null,
  message: "",
  error: null,
  version: null,
};

let state = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<FfmpegInstallState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let eventsReady = false;

export function initFfmpegInstallEvents() {
  if (eventsReady) return;
  eventsReady = true;
  void onInstallProgress((p) => {
    if (!state.running || p.stage === "done" || p.stage === "error" || p.stage === "cancelled") return;
    set({
      stage: p.stage,
      percent: p.percent,
      message: p.message,
      downloaded: p.downloaded || state.downloaded,
      total: p.total ?? state.total,
    });
  });
  // Installation deja en cours (ex. fenetre rechargee).
  void ffmpegApi
    .installRunning()
    .then((running) => running && !state.running && set({ ...initial, running: true, stage: "downloading", message: "Installation en cours…" }))
    .catch(() => undefined);
}

export function startFfmpegInstall() {
  if (state.running) return;
  set({ ...initial, running: true, stage: "checking", message: "Connexion à la source officielle…" });
  ffmpegApi
    .install()
    .then((info) => {
      queryClient.setQueryData(qk.ffmpeg, info);
      set({ running: false, stage: "done", percent: 100, message: "FFmpeg installé et vérifié.", version: info.version });
    })
    .catch((error) => {
      const e = toAppError(error);
      set({
        running: false,
        stage: e.kind === "cancelled" ? "cancelled" : "error",
        error: e.kind === "cancelled" ? null : e.message,
        message: e.message,
      });
    });
}

export async function cancelFfmpegInstall() {
  await ffmpegApi.cancelInstall();
}

export function resetFfmpegInstall() {
  if (!state.running) set(initial);
}

export function useFfmpegInstall(): FfmpegInstallState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}

export const INSTALL_STAGE_LABEL: Record<FfmpegInstallStage, string> = {
  checking: "Connexion à la source",
  downloading: "Téléchargement",
  verifying: "Vérification SHA-256",
  extracting: "Extraction",
  testing: "Test des encodeurs",
  done: "Installé",
  error: "Échec",
  cancelled: "Annulé",
};
