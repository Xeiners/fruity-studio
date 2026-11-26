import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { invalidate } from "@/hooks/queries";
import { productionsApi } from "@/services/storage/productions";
import type { Clip } from "@/types";
import { VIDEO_EXTENSIONS, detectClipNumber, fileNameFromPath } from "@/utils/clips";
import { notifyError, notifySuccess } from "@/utils/notify";

export const VIDEO_FILTER = [{ name: "Vidéos", extensions: VIDEO_EXTENSIONS }];

/**
 * Import d'une video pour un clip precis, avec garde-fous :
 * - nom de fichier designant un autre clip -> confirmation explicite ;
 * - remplacement d'une video existante -> confirmation ;
 * - meme video deja associee a un autre clip -> refus (cote Rust).
 */
export function useClipImport(totalClips: number) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [busyClip, setBusyClip] = useState<string | null>(null);

  const importFor = useCallback(
    async (clip: Clip, path: string, options: { skipChecks?: boolean } = {}) => {
      const name = fileNameFromPath(path);
      if (!options.skipChecks) {
        const detected = detectClipNumber(name);
        if (detected !== null && detected !== clip.clipNumber && detected <= totalClips) {
          const ok = await confirm({
            title: `Ce fichier semble être le clip ${detected}`,
            description: `« ${name} » contient le numéro ${detected}, mais vous l'importez dans le clip ${clip.clipNumber}. Vérifiez qu'il s'agit bien de la vidéo générée avec le prompt du clip ${clip.clipNumber}.`,
            confirmLabel: `Associer au clip ${clip.clipNumber}`,
          });
          if (!ok) return false;
        }
        if (clip.video) {
          const ok = await confirm({
            title: `Remplacer la vidéo du clip ${clip.clipNumber} ?`,
            description: `La vidéo actuelle (« ${clip.video.originalName} ») sera retirée de ce clip et remplacée par « ${name} ».`,
            confirmLabel: "Remplacer",
          });
          if (!ok) return false;
        }
      }
      setBusyClip(clip.id);
      try {
        const updated = await productionsApi.importClipVideo(clip.id, path);
        invalidate(client, "production", "productions", "media", "stats");
        const v = updated.video;
        const warn = v && v.durationMs != null && Math.abs(v.durationMs / 1000 - clip.duration) > 1.5;
        notifySuccess(
          `Vidéo associée au clip ${clip.clipNumber}`,
          warn ? `Attention : durée ${(v!.durationMs! / 1000).toFixed(1)} s au lieu de ${clip.duration} s.` : name,
        );
        return true;
      } catch (e) {
        notifyError(e, `Import impossible pour le clip ${clip.clipNumber}`);
        return false;
      } finally {
        setBusyClip(null);
      }
    },
    [client, confirm, totalClips],
  );

  const pickFor = useCallback(
    async (clip: Clip) => {
      const selected = await openDialog({ multiple: false, filters: VIDEO_FILTER, title: `Vidéo générée pour le clip ${clip.clipNumber}` });
      if (typeof selected === "string") await importFor(clip, selected);
    },
    [importFor],
  );

  const removeFrom = useCallback(
    async (clip: Clip) => {
      if (!clip.video) return;
      const ok = await confirm({
        title: `Retirer la vidéo du clip ${clip.clipNumber} ?`,
        description: "La copie gérée par Fruity Studio sera supprimée. Votre fichier d'origine n'est pas concerné.",
        confirmLabel: "Retirer",
        destructive: true,
      });
      if (!ok) return;
      try {
        await productionsApi.removeClipVideo(clip.id);
        invalidate(client, "production", "productions", "media", "stats");
      } catch (e) {
        notifyError(e, "Suppression impossible");
      }
    },
    [client, confirm],
  );

  return { importFor, pickFor, removeFrom, busyClip };
}
