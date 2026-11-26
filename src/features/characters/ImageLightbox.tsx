import { useEffect } from "react";
import { ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { LocalImage } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { systemApi } from "@/services/storage/system";
import type { MediaAsset } from "@/types";
import { angle } from "@/utils/catalog";
import { formatBytes } from "@/utils/format";
import { notifyError } from "@/utils/notify";

/** Visionneuse plein ecran des images de reference (fleches clavier). */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  title,
}: {
  images: MediaAsset[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  title: string;
}) {
  const open = index !== null && images[index] !== undefined;
  const image = open ? images[index!] : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndexChange((index! + 1) % images.length);
      if (e.key === "ArrowLeft") onIndexChange((index! - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onIndexChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1200px,94vw)] bg-background" aria-describedby={undefined}>
        {image && (
          <>
            <div className="relative flex h-[min(78vh,860px)] items-center justify-center checker">
              <LocalImage path={image.filePath} alt={`${title} — ${angle(image.label).label}`} fit="contain" className="size-full p-4" />
              {images.length > 1 && (
                <>
                  <Button variant="secondary" size="icon" className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full shadow-lg" aria-label="Image précédente" onClick={() => onIndexChange((index! - 1 + images.length) % images.length)}>
                    <ChevronLeft />
                  </Button>
                  <Button variant="secondary" size="icon" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full shadow-lg" aria-label="Image suivante" onClick={() => onIndexChange((index! + 1) % images.length)}>
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-5 py-3">
              <Badge variant="lime">{angle(image.label).label}</Badge>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-[13px]">{image.caption || image.originalName}</DialogTitle>
                <DialogDescription className="text-[11.5px]">
                  {image.width && image.height ? `${image.width} × ${image.height} px · ` : ""}
                  {formatBytes(image.sizeBytes)} · {index! + 1}/{images.length}
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => systemApi.reveal(image.filePath).catch((e) => notifyError(e, "Ouverture impossible"))}
              >
                <FolderOpen /> Afficher dans l'Explorateur
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
