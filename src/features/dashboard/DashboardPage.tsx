import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  Check,
  Clapperboard,
  CircleDashed,
  Film,
  KeyRound,
  Plus,
  Sparkles,
  UserPlus,
  UsersRound,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CharacterAvatar } from "@/components/common/media";
import { Page, PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, Progress, Skeleton } from "@/components/ui/display";
import { useCharacters, useFfmpeg, useKeyStatus, useProductions, useStats } from "@/hooks/queries";
import { ProductionCard } from "@/features/production/ProductionCard";
import { INSTALL_STAGE_LABEL, startFfmpegInstall, useFfmpegInstall } from "@/features/setup/ffmpegInstallStore";
import { openSetup } from "@/features/setup/setupStore";
import { cn } from "@/utils/cn";
import { formatRelative, pluralize } from "@/utils/format";
import { PRODUCTION_STATE_LABEL, productionState } from "@/utils/status";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 18) return "Bonjour";
  return "Bonsoir";
}

function StatTile({ icon: Icon, label, value, hint, accent }: { icon: LucideIcon; label: string; value: number | undefined; hint: string; accent?: "lime" | "orange" }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", accent === "lime" ? "text-primary-strong" : accent === "orange" ? "text-orange" : "text-muted-foreground")} strokeWidth={1.75} />
      </div>
      {value === undefined ? (
        <Skeleton className="h-8 w-14" />
      ) : (
        <span className="font-mono text-[28px] leading-none font-medium tracking-tight tabular-nums">{value}</span>
      )}
      <span className="text-[11.5px] text-muted-foreground">{hint}</span>
    </Card>
  );
}

function SetupStep({
  done,
  title,
  description,
  to,
  action,
  onAction,
  primary,
  status,
}: {
  done: boolean;
  title: string;
  description: string;
  to?: string;
  action: string;
  onAction?: () => void;
  primary?: boolean;
  /** Etat en cours (ex. progression d'installation) affiche a la place du bouton. */
  status?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border",
          done ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : <CircleDashed className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-medium", done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{title}</p>
        <p className="text-[12px] text-muted-foreground">{description}</p>
      </div>
      {!done &&
        (status ? (
          <span className="font-mono text-[11.5px] text-primary-strong">{status}</span>
        ) : onAction ? (
          <Button variant={primary ? "default" : "outline"} size="xs" onClick={onAction}>
            {action} <ArrowRight />
          </Button>
        ) : (
          <Button asChild variant="outline" size="xs">
            <Link to={to ?? "/"}>
              {action} <ArrowRight />
            </Link>
          </Button>
        ))}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const stats = useStats();
  const productions = useProductions();
  const characters = useCharacters(false);
  const { data: key } = useKeyStatus();
  const { data: ffmpeg } = useFfmpeg();
  const install = useFfmpegInstall();

  const allProductions = productions.data ?? [];
  const recent = allProductions.slice(0, 4);
  const unfinished = allProductions.filter((p) => p.status !== "rendered").slice(0, 5);
  const recentCharacters = [...(characters.data ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const setup = [
    {
      done: Boolean(key?.configured),
      title: "Connecter Gemini",
      description: "Collez votre clé API : elle est enregistrée dans le Gestionnaire d'identification Windows et testée.",
      action: "Saisir la clé",
      onAction: openSetup,
      primary: true,
    },
    {
      done: Boolean(ffmpeg?.found),
      title: ffmpeg?.managedInstalled ? "Vérifier FFmpeg" : "Installer FFmpeg",
      description:
        install.stage === "error" && install.error
          ? `Échec : ${install.error}`
          : ffmpeg?.managedInstalled
            ? (ffmpeg.error ?? "FFmpeg est installé mais n'a pas pu être vérifié.")
            : "Un clic : téléchargement depuis la source officielle, vérification SHA-256 et installation automatiques.",
      action: ffmpeg?.managedInstalled ? "Vérifier" : install.stage === "error" ? "Réessayer" : "Installer",
      onAction: ffmpeg?.canAutoInstall && !ffmpeg.managedInstalled ? startFfmpegInstall : openSetup,
      primary: true,
      status: install.running
        ? install.stage === "downloading"
          ? `Téléchargement ${Math.round(install.percent)} %`
          : `${install.stage ? INSTALL_STAGE_LABEL[install.stage] : "Installation"}…`
        : null,
    },
    { done: (stats.data?.characters ?? 0) > 0, title: "Créer un premier personnage", description: "Avec ses images de référence (face, profil, 3/4…).", to: "/characters/new", action: "Créer" },
    { done: (stats.data?.productions ?? 0) > 0, title: "Lancer une première production", description: "Sélectionnez vos personnages et laissez Gemini écrire.", to: "/productions/new", action: "Lancer" },
  ];
  const setupComplete = setup.every((s) => s.done);
  const loadingSetup = stats.isLoading || key === undefined || ffmpeg === undefined;

  return (
    <Page>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
        title={`${greeting()}, prêt à tourner ?`}
        description="Vos personnages, vos histoires et vos vidéos TikTok, au même endroit."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/characters/new")}>
              <UserPlus /> Nouveau personnage
            </Button>
            <Button size="lg" onClick={() => navigate("/productions/new")}>
              <Sparkles /> Nouvelle production
            </Button>
          </>
        }
      />

      {stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={UsersRound} label="Personnages" value={stats.data?.characters} hint={`${pluralize(stats.data?.referenceImages ?? 0, "image")} de référence`} accent="lime" />
          <StatTile icon={Clapperboard} label="Productions" value={stats.data?.productions} hint={pluralize(stats.data?.importedClips ?? 0, "clip importé", "clips importés")} />
          <StatTile icon={Film} label="Vidéos terminées" value={stats.data?.completedVideos} hint="Rendus MP4 finalisés" accent="lime" />
          <StatTile icon={Wrench} label="Brouillons" value={stats.data?.draftProductions} hint="Productions à terminer" accent="orange" />
        </div>
      )}

      {!loadingSetup && !setupComplete && (
        <Card className="overflow-hidden animate-rise">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-[13.5px] font-semibold">Bien démarrer</p>
              <p className="text-[12px] text-muted-foreground">
                {setup.filter((s) => s.done).length} étape(s) sur {setup.length} terminée(s)
              </p>
            </div>
            <KeyRound className="size-4 text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {setup.map((s) => (
              <SetupStep key={s.title} {...s} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-4">
          <SectionTitle
            title="Productions récentes"
            actions={
              allProductions.length > 0 && (
                <Button asChild variant="ghost" size="sm">
                  <Link to="/productions">
                    Tout voir <ArrowRight />
                  </Link>
                </Button>
              )
            }
          />
          {productions.isLoading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/6] rounded-xl" />
              ))}
            </div>
          ) : productions.isError ? (
            <ErrorState error={productions.error} onRetry={() => productions.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title="Aucune production pour l'instant"
              description="Choisissez vos personnages, cliquez sur Générer : Gemini écrit une histoire découpée en clips prêts pour Google Flow."
              action={
                <Button onClick={() => navigate("/productions/new")}>
                  <Plus /> Nouvelle production
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {recent.map((p) => (
                <ProductionCard key={p.id} production={p} />
              ))}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <SectionTitle title="À terminer" description="Reprenez là où vous vous êtes arrêté" />
            <Card className="divide-y divide-border overflow-hidden">
              {productions.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-10" />
                </div>
              ) : unfinished.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">Rien en attente. Tout est terminé.</p>
              ) : (
                unfinished.map((p) => (
                  <Link key={p.id} to={`/productions/${p.id}`} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{p.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(p.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={p.clipCount ? (p.importedCount / p.clipCount) * 100 : 0} className="h-1" />
                      <span className="shrink-0 text-[11px] text-muted-foreground">{PRODUCTION_STATE_LABEL[productionState(p)]}</span>
                    </div>
                  </Link>
                ))
              )}
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle
              title="Personnages récents"
              actions={
                <Button asChild variant="ghost" size="xs">
                  <Link to="/characters">Bibliothèque</Link>
                </Button>
              }
            />
            {characters.isLoading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : recentCharacters.length === 0 ? (
              <EmptyState
                compact
                icon={UsersRound}
                title="Votre casting est vide"
                description="Créez un personnage une fois, réutilisez-le partout."
                action={
                  <Button size="sm" variant="outline" onClick={() => navigate("/characters/new")}>
                    <UserPlus /> Créer
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {recentCharacters.map((c) => (
                  <Link
                    key={c.id}
                    to={`/characters/${c.id}`}
                    className="flex flex-col items-center gap-2 rounded-lg border border-transparent p-2.5 text-center transition-colors hover:border-border hover:bg-card"
                  >
                    <CharacterAvatar name={c.name} species={c.species} color={c.color} coverPath={c.coverPath} size={52} />
                    <div className="w-full min-w-0">
                      <p className="truncate text-[12.5px] font-medium">{c.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{c.species}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </Page>
  );
}
