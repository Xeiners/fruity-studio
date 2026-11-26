import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge, Card, Kbd } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { GenerationErrorNotice, GenerationProgress } from "@/features/stories/GenerationStatus";
import { openSetup } from "@/features/setup/setupStore";
import { invalidate, useKeyStatus } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/useHotkeys";
import { parseCharacterIdentity } from "@/services/gemini/schemas";
import { charactersApi } from "@/services/storage/characters";
import type { CharacterDetail, CharacterEssentials, CharacterGeneration } from "@/types";
import { formatRelative } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";
import {
  CHARACTER_PHASE_LABEL,
  cancelCharacterGeneration,
  clearCharacterGenerationError,
  startCharacterGeneration,
  useCharacterGeneration,
} from "./characterGenerationStore";
import { CharacterPromptCard } from "./CharacterPromptCard";
import { EssentialsFields, essentialsOf, validateEssentials, type EssentialsErrors } from "./EssentialsFields";

function useElapsedSeconds(startedAt: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);
  return running ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/** Saisie, generation, versions et prompt : tout le parcours dans la fiche. */
export function CharacterStudio({ character }: { character: CharacterDetail }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const { data: key } = useKeyStatus();
  const generation = useCharacterGeneration(character.id);
  const elapsed = useElapsedSeconds(generation.startedAt, generation.running);

  const saved = essentialsOf(character);
  const savedKey = JSON.stringify(saved);
  const [form, setForm] = useState(saved);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  const [errors, setErrors] = useState<EssentialsErrors>({});
  const [saving, setSaving] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [seenActive, setSeenActive] = useState(character.activeGenerationId);

  // Le formulaire suit la base apres un enregistrement ou « Reprendre ces informations ».
  if (savedKey !== syncedKey) {
    setSyncedKey(savedKey);
    setForm(saved);
  }
  // Une nouvelle version s'affiche des qu'elle devient la version utilisee.
  if (seenActive !== character.activeGenerationId) {
    setSeenActive(character.activeGenerationId);
    setViewedId(null);
    setInstruction("");
  }

  // Le prompt est en haut de la fiche : on y remonte quand il change.
  const activeSeenOnce = useRef(false);
  useEffect(() => {
    if (activeSeenOnce.current) document.getElementById("main-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
    activeSeenOnce.current = true;
  }, [character.activeGenerationId]);

  const versions = character.generations;
  const active = versions.find((v) => v.id === character.activeGenerationId) ?? null;
  const viewed: CharacterGeneration | null = versions.find((v) => v.id === viewedId) ?? active ?? versions[0] ?? null;
  const brief: CharacterEssentials = essentialsOf(form);
  const dirty = JSON.stringify(brief) !== savedKey;
  const hasVersions = versions.length > 0;

  const refresh = () => invalidate(client, "character", "characters");

  /** Enregistre la saisie ; renvoie faux si elle est invalide ou si l'ecriture echoue. */
  const persist = async (): Promise<boolean> => {
    const nextErrors = validateEssentials(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return false;
    if (!dirty) return true;
    setSaving(true);
    try {
      await charactersApi.update(character.id, brief);
      refresh();
      return true;
    } catch (e) {
      notifyError(e, "Enregistrement impossible");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (dirty && (await persist())) notifySuccess("Informations enregistrées");
  };

  const generate = async () => {
    if (generation.running) return;
    if (key && !key.configured) {
      openSetup();
      return;
    }
    if (!(await persist())) return;
    const previous = instruction.trim() && viewed ? parseCharacterIdentity(viewed.identity) : null;
    void startCharacterGeneration({ character, brief, instruction, previous });
  };

  useHotkeys([
    { combo: "mod+s", handler: () => void save(), allowInInputs: true },
    { combo: "mod+enter", handler: () => void generate(), allowInInputs: true },
  ]);

  const activate = async (version: CharacterGeneration) => {
    try {
      await charactersApi.activateGeneration(character.id, version.id);
      refresh();
      notifySuccess(`Version ${version.version} utilisée`, "Les prochaines productions s'appuieront sur elle.");
    } catch (e) {
      notifyError(e);
    }
  };

  const removeVersion = async (version: CharacterGeneration) => {
    const ok = await confirm({
      title: `Supprimer la version ${version.version} ?`,
      description: "Son prompt sera supprimé. Les images déjà importées dans la galerie sont conservées.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await charactersApi.deleteGeneration(version.id);
      setViewedId(null);
      refresh();
    } catch (e) {
      notifyError(e, "Suppression impossible");
    }
  };

  const reuseBrief = async (version: CharacterGeneration) => {
    try {
      await charactersApi.update(character.id, essentialsOf(version.brief));
      refresh();
      notifySuccess("Informations reprises", `Le formulaire reprend la saisie de la version ${version.version}.`);
    } catch (e) {
      notifyError(e);
    }
  };

  const briefDiffers = viewed !== null && JSON.stringify(essentialsOf(viewed.brief)) !== savedKey;

  // Les versions ne prennent de la place que lorsqu'il y en a plusieurs.
  const versionControls = viewed && versions.length > 1 && (
    <div className="flex flex-wrap items-center gap-2">
      {briefDiffers && (
        <Button size="xs" variant="ghost" onClick={() => void reuseBrief(viewed)}>
          <Undo2 /> Reprendre ses informations
        </Button>
      )}
      {viewed.id === character.activeGenerationId ? (
        <Badge variant="lime">
          <Check /> Utilisée
        </Badge>
      ) : (
        <Button size="xs" variant="outline" onClick={() => void activate(viewed)}>
          <Check /> Utiliser cette version
        </Button>
      )}
      <Select value={viewed.id} onValueChange={setViewedId}>
        <SelectTrigger className="h-7 w-[190px] text-[12px]" aria-label="Version affichée">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id} hint={v.instruction || v.model || undefined}>
              Version {v.version} · {formatRelative(v.createdAt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon-xs" variant="ghost" aria-label={`Supprimer la version ${viewed.version}`} onClick={() => void removeVersion(viewed)}>
        <Trash2 />
      </Button>
    </div>
  );

  return (
    <>
      {viewed && <CharacterPromptCard key={viewed.id} character={character} generation={viewed} actions={versionControls} />}

      <Card className="flex flex-col gap-5 p-5">
        <h2 className="text-[13.5px] font-semibold tracking-tight">Les essentiels</h2>
        <EssentialsFields
          value={form}
          errors={errors}
          disabled={generation.running}
          onChange={(field, value) => {
            setForm((f) => ({ ...f, [field]: value }));
            setErrors((e) => ({ ...e, [field]: undefined }));
          }}
        />
        {hasVersions && (
          <Field label="Que faut-il changer ?" htmlFor="character-instruction" hint="Facultatif. Laissez vide pour une nouvelle version à partir des informations ci-dessus.">
            <Input
              id="character-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={generation.running}
              placeholder="Ex. Plus rond, avec de plus grands yeux."
            />
          </Field>
        )}

        {generation.running ? (
          <GenerationProgress
            phase={generation.phase}
            elapsed={elapsed}
            onCancel={() => cancelCharacterGeneration(character.id)}
            labels={CHARACTER_PHASE_LABEL}
            estimate="vous pouvez quitter cette page, la génération continue"
          />
        ) : generation.error ? (
          <GenerationErrorNotice error={generation.error} onRetry={() => void generate()} onDismiss={() => clearCharacterGenerationError(character.id)} />
        ) : null}

        <div className="flex flex-col items-end gap-2.5 border-t border-border pt-4">
          <div className="flex flex-wrap justify-end gap-2">
            {dirty && (
              <Button variant="outline" size="lg" onClick={() => void save()} loading={saving} disabled={generation.running}>
                {!saving && <Save />} Enregistrer
              </Button>
            )}
            <Button size="lg" onClick={() => void generate()} loading={generation.running} disabled={saving}>
              {!generation.running && <Sparkles />}
              {generation.running ? "Génération en cours…" : hasVersions ? "Régénérer" : "Générer mon personnage"}
            </Button>
          </div>
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Kbd>Ctrl Entrée</Kbd> · consomme 1 requête Gemini (2 si correction)
          </span>
        </div>
      </Card>
    </>
  );
}
