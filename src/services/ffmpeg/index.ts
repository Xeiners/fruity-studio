/** Service FFmpeg : detection, installation automatique, rendu final et progression. */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FfmpegInfo,
  FfmpegInstallProgress,
  FfmpegSelfTestResult,
  RenderOptions,
  RenderProgress,
  RenderResult,
} from "@/types";
import { call } from "@/services/storage/invoke";

export const RENDER_PROGRESS_EVENT = "render-progress";
export const INSTALL_PROGRESS_EVENT = "ffmpeg-install-progress";

export const ffmpegApi = {
  detect: (force = false) => call<FfmpegInfo>("ffmpeg_detect", { force }),
  /** Telecharge (source officielle), verifie (SHA-256) et installe FFmpeg dans le dossier de l'application. */
  install: () => call<FfmpegInfo>("ffmpeg_install"),
  cancelInstall: () => call<boolean>("ffmpeg_install_cancel"),
  installRunning: () => call<boolean>("ffmpeg_install_status"),
  uninstall: () => call<FfmpegInfo>("ffmpeg_uninstall"),
  /** Encode une video de test 1080x1920 H.264 + AAC et la verifie. */
  selfTest: () => call<FfmpegSelfTestResult>("ffmpeg_self_test"),
  render: (productionId: string, options: RenderOptions) =>
    call<RenderResult>("production_render", { productionId, options }),
  cancel: () => call<boolean>("render_cancel"),
  status: () => call<string | null>("render_status"),
};

export function onRenderProgress(handler: (progress: RenderProgress) => void): Promise<UnlistenFn> {
  return listen<RenderProgress>(RENDER_PROGRESS_EVENT, (event) => handler(event.payload));
}

export function onInstallProgress(handler: (progress: FfmpegInstallProgress) => void): Promise<UnlistenFn> {
  return listen<FfmpegInstallProgress>(INSTALL_PROGRESS_EVENT, (event) => handler(event.payload));
}

/** Alternative manuelle (PowerShell). */
export const FFMPEG_INSTALL_COMMAND = "winget install --id Gyan.FFmpeg -e";

/** Taille approximative du telechargement (build essentials gyan.dev). */
export const FFMPEG_DOWNLOAD_SIZE_LABEL = "≈ 110 Mo";

export const DEFAULT_RENDER_OPTIONS: Omit<RenderOptions, "outputDir" | "fileName" | "width" | "height" | "fps"> = {
  fitMode: "blur",
  transition: "none",
  transitionDuration: 0.4,
  normalizeAudio: true,
  clipVolume: 1,
  musicAssetId: null,
  musicVolume: 0.25,
  musicDucking: true,
  musicFadeOut: true,
};
