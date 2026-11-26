import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ImagePlus, Maximize2, MoreHorizontal, Pencil, RefreshCw, Star, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { LocalImage } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/menus";
import { invalidate } from "@/hooks/queries";
import { useDropZone } from "@/hooks/useFileDrop";
import { charactersApi } from "@/services/storage/characters";
import { systemApi } from "@/services/storage/system";
import type { CharacterDetail, MediaAsset } from "@/types";
import { ANGLES, angle } from "@/utils/catalog";
import { IMAGE_EXTENSIONS, hasExtension } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { notifyError, notifySuccess } from "@/utils/notify";
import { ImageLightbox } from "./ImageLightbox";

export const IMAGE_FILTER = [{ name: "Images", extensions: IMAGE_EXTENSIONS }];

function EditImageDialog({ image, onClose, onSaved }: { image: MediaAsset | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(image?.label ?? "other");
  const [caption, setCaption] = useState(image?.caption ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={image !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Angle et légende</DialogTitle>
          <DialogDescription>Indiquez ce que montre cette image de référence.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Angle de vue">
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANGLES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Légende (facultatif)" hint="Ex. « colère », « tenue de soirée », « assis ».">
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={80} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              if (!image) return;
              setSaving(true);
              try {
                await charactersApi.updateImage(image.id, label, caption);
                onSaved();
                onClose();
              } catch (e) {
                notifyError(e, "Modification impossible");
              } finally {
                setSaving(false);
              }
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferenceGallery({ character }: { character: CharacterDetail }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [importing, setImporting] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  const images = character.images;
  const coverId = character.coverImageId ?? images[0]?.id;

  const refresh = () => invalidate(client, "character", "characters", "media", "stats");

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const report = await charactersApi.importImages(character.id, paths);
      refresh();
      if (report.imported.length) {
        notifySuccess(
          report.imported.length > 1 ? `${report.imported.length} images importées` : "Image importée",
          "Les angles ont été devinés d'après les noms de fichiers : vérifiez-les.",
        );
      }
      for (const f of report.failures) notifyError(new Error(f.message), "Image ignorée");
    } catch (e) {
      notifyError(e, "Import impossible");
    } finally {
      setImporting(false);
    }
  };

  const pick = async () => {
    const selected = await openDialog({ multiple: true, filters: IMAGE_FILTER, title: `Images de référence — ${character.name}` });
    if (selected) await importPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const replace = async (image: MediaAsset) => {
    const selected = await openDialog({ multiple: false, filters: IMAGE_FILTER, title: "Remplacer l'image" });
    if (!selected || Array.isArray(selected)) return;
    try {
      await charactersApi.replaceImage(image.id, selected);
      refresh();
      notifySuccess("Image remplacée", "L'angle et la légende ont été conservés. L'original n'a pas été modifié.");
    } catch (e) {
      notifyError(e, "Remplacement impossible");
    }
  };

  const remove = async (image: MediaAsset) => {
    const ok = await confirm({
      title: "Supprimer cette image ?",
      description: "La copie gérée par Fruity Studio sera supprimée. Votre fichier d'origine n'est pas concerné.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await charactersApi.deleteImage(image.id);
      refresh();
    } catch (e) {
      notifyError(e, "Suppression impossible");
    }
  };

  const setCover = async (image: MediaAsset) => {
    try {
      await charactersApi.setCover(character.id, image.id);
      refresh();
    } catch (e) {
      notifyError(e, "Modification impossible");
    }
  };

  const { dropProps, isOver, isDragging } = useDropZone(`gallery-${character.id}`, {
    accept: (p) => hasExtension(p, IMAGE_EXTENSIONS),
    onDrop: (paths) => void importPaths(paths),
    label: `la galerie de ${character.name}`,
    multiple: true,
  });

  const missingAngles = ANGLES.filter((a) => ["front", "three_quarter", "left", "right", "back"].includes(a.value)).filter(
    (a) => !images.some((img) => img.label === a.value),
  );

  return (
    <Card
      {...dropProps}
      className={cn(
        "relative overflow-hidden transition-[border-color,box-shadow]",
        isDragging && "border-dashed border-muted-foreground/50",
        isOver && "border-primary ring-4 ring-primary/15",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h2 className="text-[13.5px] font-semibold">Images de référence</h2>
          <p className="text-[12px] text-muted-foreground">
            {images.length} image(s) · glissez-déposez des fichiers ici. Les originaux ne sont jamais modifiés.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void pick()} loading={importing}>
          <ImagePlus /> Importer
        </Button>
      </div>

      {images.length === 0 ? (
        <button
          type="button"
          onClick={() => void pick()}
          className="flex w-full flex-col items-center gap-3 px-6 py-14 text-center transition-colors hover:bg-accent/30"
        >
          <div className="flex size-12 items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 text-muted-foreground">
            <Upload className="size-5" />
          </div>
          <div>
            <p className="text-[13.5px] font-medium">Importez les images de {character.name}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">La fiche modèle générée par Google Flow, ou d'autres images.</p>
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4">
          {images.map((image, index) => (
            <div key={image.id} className="group relative overflow-hidden rounded-lg border border-border bg-surface">
              <button type="button" className="block aspect-square w-full checker" onClick={() => setLightbox(index)} aria-label={`Agrandir ${angle(image.label).label}`}>
                <LocalImage path={image.filePath} alt={angle(image.label).label} fit="contain" className="size-full p-2" />
              </button>
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
                {image.id === coverId ? (
                  <Badge variant="lime" className="bg-popover/95 backdrop-blur">
                    <Star className="fill-current" /> Principale
                  </Badge>
                ) : (
                  <span />
                )}
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{angle(image.label).label}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">{image.caption || image.originalName}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label="Actions de l'image">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setLightbox(index)}>
                      <Maximize2 /> Voir en grand
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing(image)}>
                      <Pencil /> Angle et légende…
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={image.id === coverId} onSelect={() => void setCover(image)}>
                      <Star /> Définir comme image principale
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void replace(image)}>
                      <RefreshCw /> Remplacer l'image…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => systemApi.reveal(image.filePath).catch((e) => notifyError(e))}>
                      <FolderOpen /> Afficher dans l'Explorateur
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => void remove(image)}>
                      <Trash2 /> Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && missingAngles.length > 0 && !images.some((img) => img.label === "sheet") && (
        <div className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
          Angles conseillés manquants : {missingAngles.map((a) => a.label).join(", ")}.
        </div>
      )}

      {isOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
          <div className="rounded-lg bg-popover px-4 py-2 text-[13px] font-medium shadow-lg">Déposer pour importer dans la galerie de {character.name}</div>
        </div>
      )}

      <ImageLightbox images={images} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} title={character.name} />
      {editing && <EditImageDialog key={editing.id} image={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Card>
  );
}
