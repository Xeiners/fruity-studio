/**
 * Regles de decoupage d'une production en clips et detection du numero de
 * clip dans un nom de fichier (pour signaler une video importee au mauvais endroit).
 */

export const MIN_TARGET_DURATION = 5;
export const MAX_TARGET_DURATION = 180;
export const MIN_CLIP_DURATION = 4;
export const MAX_CLIP_DURATION = 20;
export const MAX_CLIPS = 12;

/** Nombre de clips : la duree cible est couverte par des clips de duree fixe. */
export function computeClipCount(targetDuration: number, clipDuration: number): number {
  if (!Number.isFinite(targetDuration) || !Number.isFinite(clipDuration) || clipDuration <= 0) return 1;
  return Math.min(MAX_CLIPS, Math.max(1, Math.ceil(targetDuration / clipDuration - 1e-9)));
}

export function totalDuration(targetDuration: number, clipDuration: number): number {
  return computeClipCount(targetDuration, clipDuration) * clipDuration;
}

/**
 * Cherche un numero de clip explicite dans un nom de fichier :
 * "clip_2.mp4", "Clip 03 final.mov", "plan-1.mp4", "scene3.mp4", "partie 2".
 * Renvoie null si aucun numero clairement identifiable.
 */
export function detectClipNumber(fileName: string): number | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const match = base.match(/(?:clip|plan|scene|scène|shot|partie|part|segment)[\s_\-#]*0*(\d{1,2})(?!\d)/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

export function hasExtension(path: string, extensions: string[]): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return extensions.includes(ext);
}
