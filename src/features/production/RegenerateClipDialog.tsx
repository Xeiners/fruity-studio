import { useState } from "react";
import { Sparkles } from "lucide-react";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form-controls";
import type { Clip } from "@/types";
import { GenerationErrorNotice, GenerationProgress } from "@/features/stories/GenerationStatus";
import type { useGeneration } from "@/features/stories/useGeneration";

export function RegenerateClipDialog({
  clip,
  generation,
  onClose,
  onRegenerate,
}: {
  clip: Clip;
  generation: ReturnType<typeof useGeneration>;
  onClose: () => void;
  onRegenerate: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !generation.running && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Régénérer le clip {clip.clipNumber}</DialogTitle>
          <DialogDescription>Gemini réécrit uniquement ce clip en gardant la continuité avec les clips voisins.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {clip.video && (
            <InlineNotice tone="warning" title="Une vidéo est déjà importée">
              Elle reste associée au clip, mais ne correspondra plus forcément au nouveau prompt.
            </InlineNotice>
          )}
          <Field label="Consigne (facultatif)" hint="Laissez vide pour une version plus drôle et plus rythmée.">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={generation.running}
              placeholder="Ex. Ajoute une chute plus absurde, et que Banane glisse sur sa propre peau."
            />
          </Field>
          {generation.running && <GenerationProgress phase={generation.phase} elapsed={generation.elapsed} onCancel={generation.cancel} />}
          {generation.error && <GenerationErrorNotice error={generation.error} onDismiss={generation.clearError} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={generation.running}>
            Annuler
          </Button>
          <Button onClick={() => onRegenerate(instruction)} loading={generation.running}>
            {!generation.running && <Sparkles />} Régénérer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
