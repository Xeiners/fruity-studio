import type {
  Character,
  CharacterDetail,
  CharacterGeneration,
  CharacterGenerationInput,
  CharacterInput,
  CharacterStatus,
  CharacterSummary,
  ImportReport,
  MediaAsset,
  ReferenceExportRequest,
  ReferenceExportResult,
  Relationship,
  RelationshipInput,
} from "@/types";
import { call } from "./invoke";

export const charactersApi = {
  list: (includeArchived = false) => call<CharacterSummary[]>("characters_list", { includeArchived }),
  get: (id: string) => call<CharacterDetail>("character_get", { id }),
  create: (input: CharacterInput) => call<Character>("character_create", { input }),
  update: (id: string, input: CharacterInput) => call<Character>("character_update", { id, input }),
  setArchived: (id: string, archived: boolean) => call<Character>("character_set_archived", { id, archived }),
  remove: (id: string) => call<void>("character_delete", { id }),
  setRelationships: (id: string, relationships: RelationshipInput[]) =>
    call<Relationship[]>("character_set_relationships", { id, relationships }),
  setCover: (id: string, assetId: string | null) => call<Character>("character_set_cover", { id, assetId }),
  /** `view` : angle et legende precis ; sinon l'angle est devine du nom de fichier. */
  importImages: (characterId: string, paths: string[], view?: { label: string; caption: string }) =>
    call<ImportReport<MediaAsset>>("character_import_images", {
      characterId,
      paths,
      label: view?.label ?? null,
      caption: view?.caption ?? null,
    }),
  setStatus: (id: string, status: CharacterStatus) => call<Character>("character_set_status", { id, status }),
  saveGeneration: (characterId: string, input: CharacterGenerationInput) =>
    call<CharacterGeneration>("character_generation_save", { characterId, input }),
  updateGenerationPrompt: (generationId: string, key: string, prompt: string) =>
    call<CharacterGeneration>("character_generation_update_prompt", { generationId, key, prompt }),
  activateGeneration: (characterId: string, generationId: string) =>
    call<Character>("character_generation_activate", { characterId, generationId }),
  deleteGeneration: (generationId: string) => call<Character>("character_generation_delete", { generationId }),
  updateImage: (assetId: string, label: string, caption: string) =>
    call<MediaAsset>("character_image_update", { assetId, label, caption }),
  replaceImage: (assetId: string, path: string) => call<MediaAsset>("character_image_replace", { assetId, path }),
  deleteImage: (assetId: string) => call<void>("character_image_delete", { assetId }),
  reorderImages: (characterId: string, orderedIds: string[]) =>
    call<MediaAsset[]>("character_images_reorder", { characterId, orderedIds }),
  exportReferences: (request: ReferenceExportRequest) =>
    call<ReferenceExportResult>("references_export", { request }),
};
