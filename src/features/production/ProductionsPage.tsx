import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Clapperboard, Plus, Search } from "lucide-react";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, GridSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/display";
import { Input } from "@/components/ui/form-controls";
import { useProductions } from "@/hooks/queries";
import { pluralize } from "@/utils/format";
import { ProductionCard } from "./ProductionCard";

type Filter = "all" | "progress" | "done";

export function ProductionsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useProductions();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((p) => (filter === "done" ? p.status === "rendered" : filter === "progress" ? p.status !== "rendered" : true))
      .filter((p) => !q || `${p.title} ${p.synopsis} ${p.characters.map((c) => c.name).join(" ")}`.toLowerCase().includes(q));
  }, [data, filter, query]);

  return (
    <Page wide>
      <PageHeader
        title="Productions"
        description="Chaque production est une histoire complète, découpée en clips à générer dans Google Flow puis assemblés en une vidéo TikTok."
        actions={
          <Button onClick={() => navigate("/productions/new")}>
            <Plus /> Nouvelle production
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une production…" className="pl-9" />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">Toutes</TabsTrigger>
            <TabsTrigger value="progress">En cours</TabsTrigger>
            <TabsTrigger value="done">Terminées</TabsTrigger>
          </TabsList>
        </Tabs>
        {data && <span className="ml-auto text-[12.5px] text-muted-foreground">{pluralize(list.length, "production")}</span>}
      </div>
      {isLoading ? (
        <GridSkeleton count={8} className="grid-cols-[repeat(auto-fill,minmax(220px,1fr))]" itemClassName="h-96" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        data && data.length > 0 ? (
          <EmptyState icon={Search} title="Aucune production ne correspond" description="Modifiez la recherche ou le filtre." />
        ) : (
          <EmptyState
            icon={Clapperboard}
            title="Votre première production vous attend"
            description="Sélectionnez des personnages, cliquez sur Générer : vous obtenez une histoire complète et un prompt Google Flow par clip."
            action={
              <Button onClick={() => navigate("/productions/new")}>
                <Plus /> Nouvelle production
              </Button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {list.map((p) => (
            <ProductionCard key={p.id} production={p} />
          ))}
        </div>
      )}
    </Page>
  );
}
