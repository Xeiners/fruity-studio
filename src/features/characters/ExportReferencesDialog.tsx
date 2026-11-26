import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderOutput, Info } from "lucide-react";
import { InlineNotice } from "@/components/common/states";
import { LocalImage } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form-controls";
import { qk, useSettings } from "@/hooks/queries";
import { charactersApi } from "@/services/storage/characters";
import { angle } from "@/utils/catalog";
import { cn } from "@/utils/cn";
import { notifyError, notifySuccess } from "@/utils/notify";

/**
 * Rassemble des images de reference dans un dossier a importer dans Google Flow.
 * Flow n'a pas acces aux fichiers locaux de Fruity Studio : cet export est
 * l'etape explicite qui rend les images disponibles a l'upload.
 */
export function ExportReferencesDialog({
  open,
  onOpenChange,
  characterIds,
  title,
  notes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterIds: string[];
  title: string;
  notes?: string;
}) {
  const { data: settings } = useSettings();
  const details = useQueries({
    queries: characterIds.map((id) => ({ queryKey: qk.character(id), queryFn: () => charactersApi.get(id), enabled: open })),
  });
  const loading = details.some((d) => d.isLoading);
  const characters = useMemo(() => details.map((d) => d.data).filter((d) => d !== undefined), [details]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destDir, setDestDir] = useState("");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Par defaut : toutes les images de tous les personnages.
  const allIds = characters.flatMap((c) => c.images.map((i) => i.id)).join("|");
  useEffect(() => {
    if (open) setSelected(new Set(allIds ? allIds.split("|") : []));
  }, [open, allIds]);
  useEffect(() => {
    if (open && settings && !destDir) setDestDir(settings.exportDir);
  }, [open, settings, destDir]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setExporting(true);
    try {
      const result = await charactersApi.exportReferences({
        title,
        characterIds,
        assetIds: Array.from(selected),
        destDir: destDir || null,
        notes: includeNotes && notes ? notes : null,
      });
      notifySuccess(`${result.fileCount} image(s) exportée(s)`, `Dossier ouvert : ${result.folder}`);
      onOpenChange(false);
    } catch (e) {
      notifyError(e, "Export impossible");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exporter les références pour Google Flow</DialogTitle>
          <DialogDescription>
            Les images choisies sont copiées dans un dossier, nommées par personnage et par angle, prêtes à être importées dans Flow.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <InlineNotice icon={Info}>
            Google Flow n'a pas accès à vos fichiers locaux : après l'export, importez vous-même ces images dans Flow (comme références
            visuelles / ingrédients) avant de coller les prompts.
          </InlineNotice>
          {loading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            characters.map((c) => (
              <div key={c.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold">
                    {c.name} <span className="font-normal text-muted-foreground">· {c.species}</span>
                  </p>
                  {c.images.length > 0 && (
                    <button
                      type="button"
                      className="text-[12px] text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          const all = c.images.every((i) => next.has(i.id));
                          for (const i of c.images) {
                            if (all) next.delete(i.id);
                            else next.add(i.id);
                          }
                          return next;
                        })
                      }
                    >
                      {c.images.every((i) => selected.has(i.id)) ? "Tout désélectionner" : "Tout sélectionner"}
                    </button>
                  )}
                </div>
                {c.images.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                    Aucune image de référence pour ce personnage.
                  </p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                    {c.images.map((img) => (
                      <label
                        key={img.id}
                        className={cn(
                          "relative cursor-pointer overflow-hidden rounded-md border transition-colors",
                          selected.has(img.id) ? "border-primary/70" : "border-border opacity-60 hover:opacity-90",
                        )}
                      >
                        <LocalImage path={img.filePath} alt={angle(img.label).label} fit="contain" className="aspect-square w-full p-1 checker" />
                        <div className="flex items-center gap-1.5 border-t border-border bg-card px-1.5 py-1">
                          <Checkbox checked={selected.has(img.id)} onCheckedChange={() => toggle(img.id)} />
                          <span className="truncate text-[11px]">{angle(img.label).label}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <Field label="Dossier de destination" hint="Un sous-dossier « <titre> - références Flow » y sera créé.">
            <div className="flex gap-2">
              <Input value={destDir} onChange={(e) => setDestDir(e.target.value)} />
              <Button
                variant="outline"
                onClick={async () => {
                  const dir = await openDialog({ directory: true, defaultPath: destDir || undefined, title: "Dossier de destination" });
                  if (typeof dir === "string") setDestDir(dir);
                }}
              >
                <FolderOpen /> Parcourir
              </Button>
            </div>
          </Field>
          {notes && (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={includeNotes} onCheckedChange={(v) => setIncludeNotes(v === true)} />
              Inclure les prompts des clips dans LISEZMOI.txt
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-[12px] text-muted-foreground">{selected.size} image(s) sélectionnée(s)</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void run()} loading={exporting} disabled={loading || characterIds.length === 0}>
            <FolderOutput /> Exporter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
