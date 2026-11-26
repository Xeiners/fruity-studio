import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Archive, FilePen, Images, Search, UserPlus, UsersRound } from "lucide-react";
import { fruitIcon, LocalImage } from "@/components/common/media";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, GridSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge, Tabs, TabsList, TabsTrigger } from "@/components/ui/display";
import { Input } from "@/components/ui/form-controls";
import { useCharacters } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/useHotkeys";
import type { CharacterSummary } from "@/types";
import { pluralize } from "@/utils/format";

type Filter = "active" | "draft" | "archived" | "all";

function CharacterCard({ character }: { character: CharacterSummary }) {
  const Icon = fruitIcon(character.species);
  return (
    <Link
      to={`/characters/${character.id}`}
      data-slot="card"
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/35 hover:shadow-lg hover:shadow-black/10"
    >
      <div className="relative aspect-[4/5] overflow-hidden border-b border-border checker">
        <LocalImage
          path={character.coverPath}
          alt={character.name}
          fit="contain"
          className="size-full p-3 transition-transform duration-500 group-hover:scale-[1.04]"
          fallback={
            <div className="flex size-full items-center justify-center" style={{ backgroundImage: `radial-gradient(circle at 50% 45%, ${character.color}33, transparent 70%)`, color: character.color }}>
              <Icon className="size-14" strokeWidth={1.25} />
            </div>
          }
        />
        <span className="absolute top-2.5 left-2.5 size-2.5 rounded-full ring-2 ring-card" style={{ backgroundColor: character.color }} />
        {character.archived ? (
          <Badge variant="outline" className="absolute top-2 right-2 bg-popover/90 backdrop-blur">
            <Archive /> Archivé
          </Badge>
        ) : (
          character.status === "draft" && (
            <Badge variant="orange" className="absolute top-2 right-2 backdrop-blur">
              <FilePen /> Brouillon
            </Badge>
          )
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[14px] font-semibold tracking-tight">{character.name}</p>
          <span className="shrink-0 text-[11.5px] text-muted-foreground">{character.species}</span>
        </div>
        <p className="line-clamp-2 min-h-[2.6em] text-[12.5px] leading-snug text-muted-foreground">
          {character.shortDescription || character.personality || "Aucune description."}
        </p>
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Images className="size-3.5" /> {character.imageCount}
          </span>
          <span>{pluralize(character.productionCount, "production")}</span>
        </div>
      </div>
    </Link>
  );
}

export function CharactersPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const { data, isLoading, isError, error, refetch } = useCharacters(filter === "archived" || filter === "all");

  useHotkeys([{ combo: "mod+f", handler: () => document.getElementById("character-search")?.focus() }]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => {
        if (filter === "archived") return c.archived;
        if (filter === "draft") return !c.archived && c.status === "draft";
        return filter === "all" || !c.archived;
      })
      .filter((c) => !q || `${c.name} ${c.species} ${c.shortDescription} ${c.personality}`.toLowerCase().includes(q));
  }, [data, filter, query]);

  return (
    <Page>
      <PageHeader
        title="Personnages"
        description="Votre casting permanent : personnalité, voix, apparence et images de référence, réutilisés dans chaque production."
        actions={
          <Button onClick={() => navigate("/characters/new")}>
            <UserPlus /> Nouveau personnage
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="character-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un personnage…"
            className="pl-9"
          />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Actifs</TabsTrigger>
            <TabsTrigger value="draft">Brouillons</TabsTrigger>
            <TabsTrigger value="archived">Archivés</TabsTrigger>
            <TabsTrigger value="all">Tous</TabsTrigger>
          </TabsList>
        </Tabs>
        {data && <span className="ml-auto text-[12.5px] text-muted-foreground">{pluralize(list.length, "personnage")}</span>}
      </div>

      {isLoading ? (
        <GridSkeleton count={8} itemClassName="h-80" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        query || filter !== "active" ? (
          <EmptyState icon={Search} title="Aucun personnage ne correspond" description="Modifiez la recherche ou le filtre." />
        ) : (
          <EmptyState
            icon={UsersRound}
            title="Créez votre premier personnage"
            description="Donnez-lui un nom, un fruit et quelques mots : Gemini écrit le prompt à coller dans Google Flow."
            action={
              <Button onClick={() => navigate("/characters/new")}>
                <UserPlus /> Nouveau personnage
              </Button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
          {list.map((c) => (
            <CharacterCard key={c.id} character={c} />
          ))}
        </div>
      )}
    </Page>
  );
}
