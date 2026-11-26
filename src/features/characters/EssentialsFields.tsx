import { DictationButton } from "@/components/common/DictationButton";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import type { CharacterEssentials } from "@/types";

export type EssentialsErrors = Partial<Record<keyof CharacterEssentials, string>>;

export const EMPTY_ESSENTIALS: CharacterEssentials = { name: "", species: "", shortDescription: "", personality: "", voice: "" };

/** Les cinq champs, sans espaces superflus (forme enregistree et comparee). */
export function essentialsOf(source: Partial<CharacterEssentials>): CharacterEssentials {
  return {
    name: source.name?.trim() ?? "",
    species: source.species?.trim() ?? "",
    shortDescription: source.shortDescription?.trim() ?? "",
    personality: source.personality?.trim() ?? "",
    voice: source.voice?.trim() ?? "",
  };
}

export function validateEssentials(form: CharacterEssentials): EssentialsErrors {
  const errors: EssentialsErrors = {};
  if (!form.name.trim()) errors.name = "Le nom est obligatoire.";
  if (!form.species.trim()) errors.species = "Précisez le fruit.";
  return errors;
}

/** Les cinq informations saisies par l'utilisateur, partagees par la creation et la fiche. */
export function EssentialsFields({
  value,
  onChange,
  errors,
  disabled,
  autoFocus,
}: {
  value: CharacterEssentials;
  onChange: (key: keyof CharacterEssentials, value: string) => void;
  errors: EssentialsErrors;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const dictation = (key: keyof CharacterEssentials, field: string) => (
    <DictationButton field={field} disabled={disabled} value={value[key]} onChange={(text) => onChange(key, text)} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" required htmlFor="character-name" error={errors.name}>
          <Input id="character-name" autoFocus={autoFocus} value={value.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Ex. Kevin" maxLength={60} disabled={disabled} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Type de fruit" required htmlFor="character-species" error={errors.species}>
          <Input id="character-species" value={value.species} onChange={(e) => onChange("species", e.target.value)} placeholder="Ex. Banane" disabled={disabled} aria-invalid={Boolean(errors.species)} />
        </Field>
      </div>
      <Field label="Description courte" htmlFor="character-description" hint="Ce que vous imaginez pour ce personnage, en quelques mots." aside={dictation("shortDescription", "description courte")}>
        <Textarea id="character-description" value={value.shortDescription} onChange={(e) => onChange("shortDescription", e.target.value)} placeholder="Ex. Une banane jaune un peu ridicule, avec des lunettes." disabled={disabled} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Personnalité" htmlFor="character-personality" aside={dictation("personality", "personnalité")}>
          <Textarea id="character-personality" value={value.personality} onChange={(e) => onChange("personality", e.target.value)} placeholder="Ex. Arrogant, maladroit, persuadé d'être intelligent." disabled={disabled} />
        </Field>
        <Field label="Ton de la voix" htmlFor="character-voice" aside={dictation("voice", "ton de la voix")}>
          <Textarea id="character-voice" value={value.voice} onChange={(e) => onChange("voice", e.target.value)} placeholder="Ex. Grave et exagérément sérieux." disabled={disabled} />
        </Field>
      </div>
    </div>
  );
}
