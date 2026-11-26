import { useMemo, useState } from "react";
import { AlertTriangle, FileVideo } from "lucide-react";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import type { Clip } from "@/types";
import { detectClipNumber, fileNameFromPath } from "@/utils/clips";

/**
 * Import de plusieurs videos d'un coup. Aucune association n'est faite en
 * silence : chaque fichier doit etre explicitement rattache a un clip
 * (pre-rempli seulement si le nom de fichier contient un numero de clip).
 */
export function BulkImportDialog({
  paths,
  clips,
  onClose,
  onConfirm,
}: {
  paths: string[];
  clips: Clip[];
  onClose: () => void;
  onConfirm: (assignments: { clip: Clip; path: string }[]) => Promise<void>;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const taken = new Set<number>();
    for (const p of paths) {
      const n = detectClipNumber(fileNameFromPath(p));
      if (n && n <= clips.length && !taken.has(n)) {
        initial[p] = String(n);
        taken.add(n);
      } else initial[p] = "";
    }
    return initial;
  });
  const [running, setRunning] = useState(false);

  const values = Object.values(mapping).filter(Boolean);
  const duplicates = useMemo(() => values.filter((v, i) => values.indexOf(v) !== i), [values]);
  const unassigned = paths.filter((p) => !mapping[p]).length;
  const replacing = clips.filter((c) => c.video && values.includes(String(c.clipNumber)));
  const valid = values.length > 0 && duplicates.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Associer les vidéos aux clips</DialogTitle>
          <DialogDescription>
            Indiquez pour chaque fichier le clip dont il est issu. Seuls les fichiers dont le nom contient un numéro de clip sont pré-associés.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {paths.map((p) => (
            <div key={p} className="grid grid-cols-[minmax(0,1fr)_190px] items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileVideo className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-[13px]" title={p}>
                  {fileNameFromPath(p)}
                </span>
              </div>
              <Select value={mapping[p] || "skip"} onValueChange={(v) => setMapping((m) => ({ ...m, [p]: v === "skip" ? "" : v }))}>
                <SelectTrigger className={!mapping[p] ? "border-dashed text-muted-foreground" : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Ne pas importer</SelectItem>
                  {clips.map((c) => (
                    <SelectItem key={c.id} value={String(c.clipNumber)} hint={c.video ? "Remplacera la vidéo actuelle" : undefined}>
                      Clip {c.clipNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {duplicates.length > 0 && (
            <InlineNotice tone="danger" icon={AlertTriangle}>
              Plusieurs fichiers sont associés au même clip ({Array.from(new Set(duplicates)).map((d) => `clip ${d}`).join(", ")}).
            </InlineNotice>
          )}
          {replacing.length > 0 && (
            <InlineNotice tone="warning" icon={AlertTriangle}>
              Les vidéos actuelles des clips {replacing.map((c) => c.clipNumber).join(", ")} seront remplacées.
            </InlineNotice>
          )}
          {unassigned > 0 && <p className="text-[12px] text-muted-foreground">{unassigned} fichier(s) ne seront pas importés.</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Annuler
          </Button>
          <Button
            disabled={!valid}
            loading={running}
            onClick={async () => {
              setRunning(true);
              try {
                const assignments = paths
                  .filter((p) => mapping[p])
                  .map((p) => ({ path: p, clip: clips.find((c) => String(c.clipNumber) === mapping[p])! }))
                  .sort((a, b) => a.clip.clipNumber - b.clip.clipNumber);
                await onConfirm(assignments);
                onClose();
              } finally {
                setRunning(false);
              }
            }}
          >
            Importer {values.length} vidéo(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
