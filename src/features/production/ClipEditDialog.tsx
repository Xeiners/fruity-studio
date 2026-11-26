import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { ClipSchema, type ClipContent, type DialogueLine } from "@/services/gemini/schemas";
import type { Clip, ProductionDetail } from "@/types";

/** Edition complete d'un clip. Le prompt final est recompose a l'enregistrement. */
export function ClipEditDialog({
  clip,
  content,
  production,
  onClose,
  onSave,
}: {
  clip: Clip;
  content: ClipContent;
  production: ProductionDetail;
  onClose: () => void;
  onSave: (content: ClipContent) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ClipContent>(content);
  const [sfx, setSfx] = useState(content.soundEffects.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const names = [...production.characters.map((c) => c.name), ...(production.story.supportingCharacters ?? []).map((c) => c.name)];

  const set = <K extends keyof ClipContent>(key: K, value: ClipContent[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setLine = (i: number, patch: Partial<DialogueLine>) =>
    set("dialogue", draft.dialogue.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    const candidate = { ...draft, soundEffects: sfx.split("\n").map((s) => s.trim()).filter(Boolean) };
    const parsed = ClipSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" · "));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
      onClose();
    } catch {
      // erreur deja notifiee ; la boite reste ouverte
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Modifier le clip {clip.clipNumber}</DialogTitle>
          <DialogDescription>Le prompt Google Flow final sera recomposé (format, style et descripteurs des personnages + scène).</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {clip.promptEdited && (
            <InlineNotice tone="warning" title="Prompt modifié à la main">
              Vos modifications manuelles du prompt final seront remplacées par la version recomposée.
            </InlineNotice>
          )}
          <Field label="Description de la scène">
            <Textarea value={draft.sceneDescription} onChange={(e) => set("sceneDescription", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lieu">
              <Input value={draft.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field label="Caméra">
              <Input value={draft.cameraDirections} onChange={(e) => set("cameraDirections", e.target.value)} />
            </Field>
          </div>
          <Field label="Dialogues">
            <div className="flex flex-col gap-2">
              {draft.dialogue.map((line, i) => (
                <div key={i} className="grid grid-cols-[140px_minmax(0,1fr)_160px_auto] gap-2">
                  <Select value={line.character} onValueChange={(v) => setLine(i, { character: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Personnage" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set([...names, line.character])).filter(Boolean).map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={line.line} onChange={(e) => setLine(i, { line: e.target.value })} placeholder="Réplique" />
                  <Input value={line.delivery} onChange={(e) => setLine(i, { delivery: e.target.value })} placeholder="Ton (ex. outrée)" />
                  <Button variant="ghost" size="icon" aria-label="Supprimer la réplique" onClick={() => set("dialogue", draft.dialogue.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="self-start" onClick={() => set("dialogue", [...draft.dialogue, { character: names[0] ?? "", line: "", delivery: "" }])}>
                <Plus /> Ajouter une réplique
              </Button>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effets sonores" hint="Un par ligne.">
              <Textarea value={sfx} onChange={(e) => setSfx(e.target.value)} />
            </Field>
            <Field label="Musique">
              <Textarea value={draft.musicInstructions} onChange={(e) => set("musicInstructions", e.target.value)} />
            </Field>
          </div>
          <Field label="Continuité">
            <Textarea value={draft.continuityInstructions} onChange={(e) => set("continuityInstructions", e.target.value)} />
          </Field>
          <Field label="Scène pour Google Flow (corps du prompt)" hint="Les dialogues, actions et caméra doivent aussi y figurer : c'est ce texte que Veo lit.">
            <Textarea value={draft.googleFlowPrompt} onChange={(e) => set("googleFlowPrompt", e.target.value)} className="min-h-40 font-mono text-[12px]" />
          </Field>
          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer et recomposer le prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
