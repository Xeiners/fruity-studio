import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ImagePlus, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { LocalImage } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/display";
import { Textarea } from "@/components/ui/form-controls";
import { invalidate } from "@/hooks/queries";
import { useDropZone } from "@/hooks/useFileDrop";
import { composeCharacterModelSheetPrompt } from "@/services/gemini/flowPrompt";
import { MODEL_SHEET_KEY, parseCharacterIdentity } from "@/services/gemini/schemas";
import { charactersApi } from "@/services/storage/characters";
import type { CharacterDetail, CharacterGeneration } from "@/types";
import { IMAGE_EXTENSIONS, hasExtension } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { notifyError, notifySuccess } from "@/utils/notify";
import { IMAGE_FILTER } from "./ReferenceGallery";

/** Le prompt unique a coller dans Google Flow, et l'image obtenue. */
export function CharacterPromptCard({ character, generation, actions }: { character: CharacterDetail; generation: CharacterGeneration; actions?: ReactNode }) {
  const client = useQueryClient();
  const stored = generation.prompts.find((p) => p.key === MODEL_SHEET_KEY);
  const identity = parseCharacterIdentity(generation.identity);
  // Les versions plus anciennes n'ont pas ce prompt : il se recompose sans appeler Gemini.
  const text =
    stored?.prompt ??
    (identity ? composeCharacterModelSheetPrompt({ name: character.name, canonicalVisual: identity.canonicalVisual, promptLanguage: identity.promptLanguage }) : null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const image = character.images.find((i) => i.label === "sheet") ?? null;
  const edited = stored !== undefined && stored.prompt !== stored.original;

  const save = async (value: string) => {
    setSaving(true);
    try {
      await charactersApi.updateGenerationPrompt(generation.id, MODEL_SHEET_KEY, value);
      invalidate(client, "character");
      setDraft(value);
      setEditing(false);
    } catch (e) {
      notifyError(e, "Modification impossible");
    } finally {
      setSaving(false);
    }
  };

  const importImage = async (path: string) => {
    setImporting(true);
    try {
      if (image) {
        await charactersApi.replaceImage(image.id, path);
      } else {
        const report = await charactersApi.importImages(character.id, [path], { label: "sheet", caption: "" });
        if (report.failures[0]) throw new Error(report.failures[0].message);
      }
      invalidate(client, "character", "characters", "media", "stats");
      notifySuccess(image ? "Image remplacée" : "Image ajoutée à la galerie");
    } catch (e) {
      notifyError(e, "Import impossible");
    } finally {
      setImporting(false);
    }
  };

  const pick = async () => {
    const selected = await openDialog({ multiple: false, filters: IMAGE_FILTER, title: `Fiche modèle — ${character.name}` });
    if (selected && !Array.isArray(selected)) await importImage(selected);
  };

  const { dropProps, isOver, isDragging } = useDropZone("character-model-sheet", {
    accept: (p) => hasExtension(p, IMAGE_EXTENSIONS),
    onDrop: ([path]) => void importImage(path),
    label: "la fiche modèle",
    disabled: importing,
  });

  return (
    <Card>
      <CardHeader className="flex-wrap items-center">
        <div>
          <CardTitle className="flex items-center gap-2">
            Prompt du personnage
            {edited && (
              <Badge variant="orange">
                <Pencil /> Modifié
              </Badge>
            )}
          </CardTitle>
          <CardDescription>À coller dans Google Flow, section personnage.</CardDescription>
        </div>
        {actions}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {text === null ? (
          <p className="text-[12.5px] text-muted-foreground">Le contenu de cette version est illisible. Régénérez le personnage ou choisissez une autre version.</p>
        ) : editing ? (
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-52 font-mono text-[12px]" autoFocus aria-label="Prompt du personnage" />
        ) : (
          <p className="rounded-lg border border-border bg-surface/60 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap" data-selectable>
            {text}
          </p>
        )}

        {text !== null && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => { setDraft(text); setEditing(false); }} disabled={saving}>
                  Annuler
                </Button>
                <Button onClick={() => void save(draft)} loading={saving} disabled={!draft.trim()}>
                  {!saving && <Check />} Enregistrer
                </Button>
              </>
            ) : (
              <>
                {edited && (
                  <Button variant="ghost" onClick={() => void save(stored.original)} loading={saving}>
                    {!saving && <RotateCcw />} Revenir au texte généré
                  </Button>
                )}
                {stored && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil /> Modifier
                  </Button>
                )}
                <CopyButton text={text} size="lg" label="Copier le prompt" toastMessage="Prompt copié : collez-le dans Google Flow" />
              </>
            )}
          </div>
        )}

        <div
          {...dropProps}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border p-2.5 transition-[border-color,box-shadow]",
            isDragging && "border-dashed border-muted-foreground/50",
            isOver && "border-primary ring-4 ring-primary/15",
          )}
        >
          <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md border border-border checker">
            {image && <LocalImage path={image.filePath} alt="Fiche modèle" fit="contain" className="size-full p-0.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium">{image ? "Image dans la galerie" : "Pas encore d'image"}</p>
            <p className="text-[11.5px] text-muted-foreground">Glissez ici l'image générée par Flow, ou choisissez un fichier.</p>
          </div>
          <Button size="xs" variant="outline" onClick={() => void pick()} loading={importing}>
            {!importing && (image ? <RefreshCw /> : <ImagePlus />)} {image ? "Remplacer" : "Importer l'image"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
