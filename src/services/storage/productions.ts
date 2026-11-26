import type {
  Clip,
  ClipUpdateInput,
  Production,
  ProductionCreateInput,
  ProductionDetail,
  ProductionSummary,
  ProductionUpdateInput,
  StoryReplaceInput,
} from "@/types";
import { call } from "./invoke";

export const productionsApi = {
  list: () => call<ProductionSummary[]>("productions_list"),
  get: (id: string) => call<ProductionDetail>("production_get", { id }),
  create: (input: ProductionCreateInput) => call<ProductionDetail>("production_create", { input }),
  update: (id: string, input: ProductionUpdateInput) => call<Production>("production_update", { id, input }),
  replaceStory: (id: string, input: StoryReplaceInput) =>
    call<ProductionDetail>("production_replace_story", { id, input }),
  remove: (id: string) => call<void>("production_delete", { id }),
  updateClip: (clipId: string, input: ClipUpdateInput) => call<Clip>("clip_update", { clipId, input }),
  importClipVideo: (clipId: string, path: string) => call<Clip>("clip_import_video", { clipId, path }),
  removeClipVideo: (clipId: string) => call<Clip>("clip_remove_video", { clipId }),
  /** Analyse les videos importees avant l'installation de FFmpeg. */
  analyzeClips: (productionId: string) => call<number>("production_analyze_clips", { productionId }),
};
