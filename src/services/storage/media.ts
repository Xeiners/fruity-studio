import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImportReport, MediaAsset, MediaItem, MediaKind } from "@/types";
import { call, isTauri } from "./invoke";

export const mediaApi = {
  list: (kind: MediaKind | null, query: string | null) => call<MediaItem[]>("media_list", { kind, query }),
  importAudio: (paths: string[], kind: "music" | "sfx") =>
    call<ImportReport<MediaAsset>>("media_import_audio", { paths, kind }),
  remove: (id: string) => call<void>("media_delete", { id }),
};

/** URL affichable d'un fichier local (protocole `asset:` de Tauri). */
export function fileUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (!isTauri()) return undefined;
  return convertFileSrc(path);
}
