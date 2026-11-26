import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Check, ImageOff, Search, UserPlus } from "lucide-react";
import { CharacterAvatar } from "@/components/common/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import type { CharacterSummary } from "@/types";
import { cn } from "@/utils/cn";

export function CharacterPicker({
  characters,
  selected,
  onChange,
  disabled,
}: {
  characters: CharacterSummary[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => !q || `${c.name} ${c.species}`.toLowerCase().includes(q));
  }, [characters, query]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <p className="text-[13.5px] font-medium">Aucun personnage dans votre bibliothèque</p>
        <p className="max-w-sm text-[12.5px] text-muted-foreground">Créez au moins un personnage : sa fiche sera transmise automatiquement à Gemini.</p>
        <Button asChild size="sm">
          <Link to="/characters/new">
            <UserPlus /> Créer un personnage
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {characters.length > 8 && (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer…" className="pl-9" />
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5" role="group" aria-label="Personnages">
        {list.map((c) => {
          const active = selected.includes(c.id);
          const order = selected.indexOf(c.id) + 1;
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => toggle(c.id)}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-[border-color,background-color,box-shadow] disabled:opacity-60",
                active ? "border-primary/70 bg-lime-soft ring-1 ring-primary/40" : "border-border bg-surface/60 hover:border-muted-foreground/40 hover:bg-accent/40",
              )}
            >
              <CharacterAvatar name={c.name} species={c.species} color={c.color} coverPath={c.coverPath} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{c.name}</p>
                <p className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
                  {c.imageCount === 0 && <ImageOff className="size-3 shrink-0 text-orange" aria-label="Sans image" />}
                  <span className="truncate">{c.species}</span>
                  {c.status === "draft" && <span className="shrink-0 text-orange">· Brouillon</span>}
                </p>
              </div>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold transition-colors",
                  active ? "border-transparent bg-primary text-primary-foreground" : "border-border text-transparent",
                )}
              >
                {active ? order || <Check className="size-3" /> : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
