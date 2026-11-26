import { Plus, Trash2 } from "lucide-react";
import { CharacterAvatar } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import type { CharacterSummary, RelationshipInput } from "@/types";

const SUGGESTIONS = ["Meilleur(e) ami(e)", "Rival(e)", "Ex", "En couple", "Frère / sœur", "Colocataire", "Collègue", "Ennemi(e) juré(e)", "Mentor"];

export function RelationshipsEditor({
  value,
  onChange,
  candidates,
}: {
  value: RelationshipInput[];
  onChange: (next: RelationshipInput[]) => void;
  candidates: CharacterSummary[];
}) {
  const used = new Set(value.map((r) => r.relatedCharacterId));
  const available = candidates.filter((c) => !used.has(c.id));
  const update = (index: number, patch: Partial<RelationshipInput>) =>
    onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-[12.5px] text-muted-foreground">
        Créez d'autres personnages pour définir des relations (amitié, rivalité, ex…). Gemini en tiendra compte dans les histoires.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {value.map((rel, index) => {
        const other = candidates.find((c) => c.id === rel.relatedCharacterId);
        return (
          <div key={rel.relatedCharacterId} className="grid grid-cols-[200px_180px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-surface/60 p-2">
            <div className="flex min-w-0 items-center gap-2 px-1">
              {other && <CharacterAvatar name={other.name} species={other.species} color={other.color} coverPath={other.coverPath} size={26} />}
              <span className="truncate text-[13px] font-medium">{other?.name ?? "Personnage supprimé"}</span>
            </div>
            <Input
              value={rel.relation}
              list="relation-suggestions"
              onChange={(e) => update(index, { relation: e.target.value })}
              placeholder="Relation (ex. Rival)"
              aria-label="Type de relation"
            />
            <Input
              value={rel.description}
              onChange={(e) => update(index, { description: e.target.value })}
              placeholder="Détail : « jaloux depuis le concours de smoothies »"
              aria-label="Description de la relation"
            />
            <Button variant="ghost" size="icon-sm" aria-label="Retirer la relation" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <datalist id="relation-suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {available.length > 0 && (
        <Select
          value=""
          onValueChange={(id) => onChange([...value, { relatedCharacterId: id, relation: "", description: "" }])}
        >
          <SelectTrigger className="w-64 border-dashed">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Plus className="size-4" />
              <SelectValue placeholder="Ajouter une relation…" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {available.map((c) => (
              <SelectItem key={c.id} value={c.id} hint={c.species}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
