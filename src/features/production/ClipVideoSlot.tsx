import { useState } from "react";
import { AlertTriangle, FileVideo, Loader2, Play, Upload } from "lucide-react";
import { LocalImage, LocalVideo } from "@/components/common/media";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDropZone } from "@/hooks/useFileDrop";
import type { Clip } from "@/types";
import { VIDEO_EXTENSIONS, hasExtension } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { formatBytes, formatDurationMs } from "@/utils/format";

export interface VideoWarning {
  message: string;
}

/** Avertissements non bloquants sur la video importee. */
export function videoWarnings(clip: Clip): string[] {
  const v = clip.video;
  if (!v) return [];
  const warnings: string[] = [];
  if (!v.fileExists) warnings.push("Fichier introuvable sur le disque.");
  if (v.durationMs != null && Math.abs(v.durationMs / 1000 - clip.duration) > 1.5) {
    warnings.push(`Durée ${(v.durationMs / 1000).toFixed(1)} s (attendu ${clip.duration} s).`);
  }
  if (v.width && v.height) {
    const ratio = v.width / v.height;
    if (Math.abs(ratio - 9 / 16) > 0.03) warnings.push(`Format ${v.width}×${v.height} : pas en 9:16 (sera adapté au rendu).`);
  }
  if (v.hasAudio === false) warnings.push("Aucune piste audio (un silence sera ajouté).");
  if (v.durationMs == null) warnings.push("Non analysée : FFmpeg est introuvable.");
  return warnings;
}

export function ClipVideoSlot({
  clip,
  busy,
  onImport,
  onDropFile,
}: {
  clip: Clip;
  busy: boolean;
  onImport: () => void;
  onDropFile: (path: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const { dropProps, isOver, isDragging } = useDropZone(`clip-${clip.id}`, {
    accept: (p) => hasExtension(p, VIDEO_EXTENSIONS),
    onDrop: (paths) => onDropFile(paths[0]),
    label: `la vidéo du clip ${clip.clipNumber}`,
    multiple: false,
    disabled: busy,
  });
  const video = clip.video;
  const warnings = videoWarnings(clip);

  return (
    <div className="flex w-[164px] shrink-0 flex-col gap-2">
      <div
        {...dropProps}
        className={cn(
          "relative aspect-[9/16] w-full overflow-hidden rounded-lg border transition-[border-color,box-shadow]",
          video ? "border-border bg-black" : "border-dashed border-muted-foreground/35 bg-surface",
          isDragging && !video && "border-muted-foreground/60",
          isOver && "border-primary ring-4 ring-primary/20",
        )}
      >
        {busy ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Import et analyse…
          </div>
        ) : video ? (
          <button type="button" className="group relative size-full" onClick={() => setPreview(true)} aria-label={`Lire la vidéo du clip ${clip.clipNumber}`}>
            {video.thumbnailPath ? (
              <LocalImage path={video.thumbnailPath} alt={`Clip ${clip.clipNumber}`} className="size-full" />
            ) : (
              <LocalVideo path={video.filePath} controls={false} className="size-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
              <span className="flex size-10 items-center justify-center rounded-full bg-white/90 text-black opacity-90 shadow-lg transition-transform group-hover:scale-110">
                <Play className="ml-0.5 size-4 fill-current" />
              </span>
            </span>
            <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {String(clip.clipNumber).padStart(2, "0")}
            </span>
          </button>
        ) : (
          <button type="button" onClick={onImport} className="flex size-full flex-col items-center justify-center gap-2 px-3 text-center transition-colors hover:bg-accent/40">
            <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
              <Upload className="size-4" />
            </span>
            <span className="text-[12px] font-medium">Vidéo du clip {clip.clipNumber}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">Glissez le MP4 généré par Flow ou cliquez</span>
          </button>
        )}
        {isOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/20 text-center text-[12px] font-semibold text-foreground backdrop-blur-[1px]">
            Associer au clip {clip.clipNumber}
          </div>
        )}
      </div>
      {video && (
        <div className="flex flex-col gap-1 px-0.5">
          <p className="flex items-center gap-1 truncate text-[11.5px] font-medium" title={video.originalName}>
            <FileVideo className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{video.originalName}</span>
          </p>
          <p className="font-mono text-[10.5px] text-muted-foreground">
            {formatDurationMs(video.durationMs)}
            {video.width && video.height ? ` · ${video.width}×${video.height}` : ""}
            {video.fps ? ` · ${Math.round(video.fps)} i/s` : ""} · {formatBytes(video.sizeBytes)}
          </p>
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1 text-[11px] leading-snug text-warning">
              <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-[min(440px,92vw)] bg-black">
          <DialogTitle className="sr-only">Aperçu du clip {clip.clipNumber}</DialogTitle>
          <DialogDescription className="sr-only">{video?.originalName}</DialogDescription>
          {video && <LocalVideo path={video.filePath} autoPlay className="aspect-[9/16] max-h-[80vh] w-full object-contain" poster={video.thumbnailPath} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
