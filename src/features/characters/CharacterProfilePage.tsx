import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowUpRight, CheckCircle2, Clapperboard, FilePen, FolderOutput, MoreHorizontal, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { CharacterAvatar } from "@/components/common/media";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menus";
import { invalidate, useCharacter, useCharacters } from "@/hooks/queries";
import { charactersApi } from "@/services/storage/characters";
import type { CharacterDetail, CharacterOlderNotes, RelationshipInput } from "@/types";
import { formatDate } from "@/utils/format";
import { notifyError, notifySuccess } from "@/utils/notify";
import { CharacterStudio } from "./CharacterStudio";
import { essentialsOf } from "./EssentialsFields";
import { ExportReferencesDialog } from "./ExportReferencesDialog";
import { ReferenceGallery } from "./ReferenceGallery";
import { RelationshipsEditor } from "./RelationshipsEditor";

const OLDER_NOTES: { key: keyof CharacterOlderNotes; label: string }[] = [
  { key: "behavior", label: "Comportement typique" },
  { key: "mannerisms", label: "Expressions et tics" },
  { key: "appearance", label: "Apparence physique" },
  { key: "distinctiveDetails", label: "Détails distinctifs" },
  { key: "creativeNotes", label: "Instructions créatives" },
];

/** Informations saisies dans l'ancienne fiche : conservees, visibles et effacables. */
function OlderNotesCard({ character, onChanged }: { character: CharacterDetail; onChanged: () => void }) {
  const confirm = useConfirm();
  const notes = OLDER_NOTES.filter((n) => character[n.key].trim());
  if (notes.length === 0) return null;

  const clear = async () => {
    const ok = await confirm({
      title: "Effacer ces anciennes notes ?",
      description: "Elles ne seront plus transmises à Gemini. Cette action est définitive.",
      confirmLabel: "Effacer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await charactersApi.update(character.id, {
        ...essentialsOf(character),
        behavior: "",
        mannerisms: "",
        appearance: "",
        distinctiveDetails: "",
        creativeNotes: "",
      });
      onChanged();
    } catch (e) {
      notifyError(e, "Modification impossible");
    }
  };

  return (
    <Card>
      <details>
        <summary className="cursor-pointer px-5 py-3.5 text-[13.5px] font-semibold tracking-tight select-none">Notes de l'ancienne fiche</summary>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            Conservées telles quelles et transmises à Gemini pour rester fidèle à ce que vous aviez écrit.
          </p>
          <dl className="divide-y divide-border">
            {notes.map((n) => (
              <div key={n.key} className="grid gap-1 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-[12.5px] text-muted-foreground">{n.label}</dt>
                <dd className="text-[13px] leading-relaxed whitespace-pre-wrap" data-selectable>
                  {character[n.key]}
                </dd>
              </div>
            ))}
          </dl>
          <Button size="xs" variant="ghost" className="self-start" onClick={() => void clear()}>
            <Trash2 /> Effacer ces notes
          </Button>
        </CardContent>
      </details>
    </Card>
  );
}

function RelationshipsDialog({ character, onClose, onSaved }: { character: CharacterDetail; onClose: () => void; onSaved: () => void }) {
  const { data: all } = useCharacters(true);
  const [value, setValue] = useState<RelationshipInput[]>(() =>
    character.relationships
      .filter((r) => r.direction === "outgoing")
      .map((r) => ({ relatedCharacterId: r.relatedCharacterId, relation: r.relation, description: r.description })),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await charactersApi.setRelationships(character.id, value.filter((r) => r.relation.trim()));
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Relations de {character.name}</DialogTitle>
          <DialogDescription>Gemini s'en sert pour les conflits et les retournements.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RelationshipsEditor value={value} onChange={setValue} candidates={(all ?? []).filter((c) => c.id !== character.id)} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SideCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function CharacterProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useConfirm();
  const { data: character, isLoading, isError, error, refetch } = useCharacter(id);
  const [exportOpen, setExportOpen] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);

  if (isError) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Page>
    );
  }
  if (isLoading || !character) {
    return (
      <Page>
        <Skeleton className="h-24 w-96" />
        <Skeleton className="h-96 rounded-xl" />
      </Page>
    );
  }

  const toggleArchive = async () => {
    try {
      await charactersApi.setArchived(character.id, !character.archived);
      invalidate(client, "character", "characters", "stats");
      notifySuccess(character.archived ? "Personnage réactivé" : "Personnage archivé", character.archived ? undefined : "Il n'apparaît plus dans les nouvelles productions.");
    } catch (e) {
      notifyError(e);
    }
  };

  const setStatus = async (status: CharacterDetail["status"]) => {
    try {
      await charactersApi.setStatus(character.id, status);
      invalidate(client, "character", "characters");
    } catch (e) {
      notifyError(e);
    }
  };

  const remove = async () => {
    const used = character.productions.length;
    const ok = await confirm({
      title: `Supprimer ${character.name} ?`,
      description:
        used > 0
          ? `Ce personnage apparaît dans ${used} production(s). Ses images de référence seront supprimées. Les productions existantes gardent leurs textes, mais perdent le lien vers le personnage. L'archivage est souvent préférable.`
          : "Le personnage et ses images de référence (copies gérées par Fruity Studio) seront supprimés définitivement.",
      confirmLabel: "Supprimer définitivement",
      destructive: true,
    });
    if (!ok) return;
    try {
      await charactersApi.remove(character.id);
      invalidate(client, "characters", "stats", "productions", "media");
      notifySuccess("Personnage supprimé");
      navigate("/characters", { replace: true });
    } catch (e) {
      notifyError(e, "Suppression impossible");
    }
  };

  const outgoing = character.relationships;

  return (
    <Page>
      <PageHeader
        back={{ to: "/characters", label: "Personnages" }}
        title={
          <span className="flex items-center gap-4">
            <CharacterAvatar name={character.name} species={character.species} color={character.color} coverPath={character.coverPath} size={64} className="rounded-2xl" />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2.5">
                {character.name}
                {character.status === "draft" && (
                  <Badge variant="orange">
                    <FilePen /> Brouillon
                  </Badge>
                )}
                {character.archived && (
                  <Badge variant="outline">
                    <Archive /> Archivé
                  </Badge>
                )}
              </span>
              <span className="text-[13.5px] font-normal tracking-normal text-muted-foreground">
                {character.species}
                {character.shortDescription ? ` — ${character.shortDescription}` : ""}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {character.status === "draft" && (
              <Button variant="outline" onClick={() => void setStatus("ready")}>
                <CheckCircle2 /> Marquer comme terminé
              </Button>
            )}
            <Button onClick={() => navigate(`/productions/new?characters=${character.id}`)} disabled={character.archived}>
              <Sparkles /> Nouvelle production
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Plus d'actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setExportOpen(true)} disabled={character.images.length === 0}>
                  <FolderOutput /> Exporter les références pour Flow…
                </DropdownMenuItem>
                {character.status === "ready" && (
                  <DropdownMenuItem onSelect={() => void setStatus("draft")}>
                    <FilePen /> Repasser en brouillon
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void toggleArchive()}>
                  {character.archived ? <ArchiveRestore /> : <Archive />} {character.archived ? "Désarchiver" : "Archiver"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => void remove()}>
                  <Trash2 /> Supprimer…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <CharacterStudio key={character.id} character={character} />
          <ReferenceGallery character={character} />
          <OlderNotesCard character={character} onChanged={() => invalidate(client, "character", "characters")} />
        </div>

        <div className="flex flex-col gap-6">
          <SideCard
            title="Relations"
            action={
              <Button variant="ghost" size="xs" onClick={() => setRelationsOpen(true)}>
                <Pencil /> Modifier
              </Button>
            }
          >
            {outgoing.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Aucune relation définie.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {outgoing.map((r) => (
                  <li key={`${r.id}-${r.direction}`}>
                    <Link to={`/characters/${r.relatedCharacterId}`} className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-accent/60">
                      <CharacterAvatar name={r.relatedName} species={r.relatedSpecies} color={r.relatedColor} coverPath={r.relatedCoverPath} size={32} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">
                          {r.relatedName} <span className="font-normal text-muted-foreground">· {r.relation}</span>
                        </p>
                        {r.direction === "incoming" && <p className="text-[11px] text-muted-foreground">Défini sur la fiche de {r.relatedName}</p>}
                        {r.description && <p className="text-[12px] text-muted-foreground">{r.description}</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SideCard>

          <SideCard title="Productions">
            {character.productions.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">N'apparaît encore dans aucune production.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {character.productions.map((p) => (
                  <li key={p.id}>
                    <Link to={`/productions/${p.id}`} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
                      <Clapperboard className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
                      <span className="text-[11px] text-muted-foreground">{formatDate(p.updatedAt)}</span>
                      <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SideCard>
        </div>
      </div>

      <ExportReferencesDialog open={exportOpen} onOpenChange={setExportOpen} characterIds={[character.id]} title={character.name} />
      {relationsOpen && <RelationshipsDialog character={character} onClose={() => setRelationsOpen(false)} onSaved={() => invalidate(client, "character", "characters", "productions")} />}
    </Page>
  );
}
