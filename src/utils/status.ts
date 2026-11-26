/** Etats derives des productions et des clips (jamais stockes : pas de desynchronisation). */
import type { Clip, Production, ProductionSummary } from "@/types";

export type ClipState = "awaiting" | "imported" | "ready" | "rendered";

export const CLIP_STATE_LABEL: Record<ClipState, string> = {
  awaiting: "En attente de génération",
  imported: "Vidéo importée",
  ready: "Prêt pour le rendu",
  rendered: "Rendu",
};

export const CLIP_STATE_TONE: Record<ClipState, "outline" | "orange" | "lime" | "success"> = {
  awaiting: "outline",
  imported: "orange",
  ready: "lime",
  rendered: "success",
};

export function clipState(clip: Clip, production: Pick<Production, "renderedAt" | "finalVideoId">): ClipState {
  const video = clip.video;
  if (!video || !video.fileExists) return "awaiting";
  if (production.finalVideoId && production.renderedAt && clip.videoImportedAt && clip.videoImportedAt <= production.renderedAt) {
    return "rendered";
  }
  // "Pret" = video analysee par ffprobe (dimensions et duree connues).
  if (video.durationMs != null && video.width != null) return "ready";
  return "imported";
}

export interface ProductionProgress {
  total: number;
  imported: number;
  missing: number[];
  allImported: boolean;
  renderOutdated: boolean;
}

export function productionProgress(production: Production & { clips: Clip[] }): ProductionProgress {
  const missing = production.clips.filter((c) => !c.video || !c.video.fileExists).map((c) => c.clipNumber);
  const total = production.clips.length;
  const renderOutdated = Boolean(
    production.renderedAt && production.clips.some((c) => c.videoImportedAt && c.videoImportedAt > production.renderedAt!),
  );
  return { total, imported: total - missing.length, missing, allImported: total > 0 && missing.length === 0, renderOutdated };
}

export type ProductionState = "draft" | "prompts" | "importing" | "ready" | "done";

export const PRODUCTION_STATE_LABEL: Record<ProductionState, string> = {
  draft: "Brouillon",
  prompts: "Prompts prêts",
  importing: "Import des vidéos",
  ready: "Prête pour le rendu",
  done: "Terminée",
};

export const PRODUCTION_STATE_TONE: Record<ProductionState, "outline" | "default" | "orange" | "lime" | "success"> = {
  draft: "outline",
  prompts: "default",
  importing: "orange",
  ready: "lime",
  done: "success",
};

export function productionState(p: Pick<ProductionSummary, "status" | "clipCount" | "importedCount">): ProductionState {
  if (p.status === "rendered") return "done";
  if (p.clipCount === 0) return "draft";
  if (p.importedCount === 0) return "prompts";
  if (p.importedCount < p.clipCount) return "importing";
  return "ready";
}
