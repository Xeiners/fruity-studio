import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOff, KeyRound, Sparkles, Wand2 } from "lucide-react";
import { AvatarStack } from "@/components/common/media";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { DictationButton } from "@/components/common/DictationButton";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, Kbd, Separator, Skeleton } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { invalidate, qk, useCharacters, useKeyStatus, useProductions, useSettings } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/useHotkeys";
import { generateProduction, continuityFrom } from "@/services/gemini/generator";
import { charactersApi } from "@/services/storage/characters";
import { productionsApi } from "@/services/storage/productions";
import type { ComedyStyle, MusicMode, PromptLanguage } from "@/types";
import { COMEDY_STYLES, LANGUAGES, comedyStyle } from "@/utils/catalog";
import { MAX_CLIP_DURATION, MAX_TARGET_DURATION, MIN_CLIP_DURATION, MIN_TARGET_DURATION, computeClipCount } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { formatSeconds } from "@/utils/format";
import { notifySuccess } from "@/utils/notify";
import { CharacterPicker } from "./CharacterPicker";
import { ClipTimeline } from "./ClipTimeline";
import { GenerationErrorNotice, GenerationProgress } from "./GenerationStatus";
import { InventCharactersOption } from "./InventCharactersOption";
import { useGeneration } from "./useGeneration";

const TARGET_PRESETS = [15, 30, 45, 60];

function Step({ index, title, description, children }: { index: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-[11px] text-muted-foreground">
          {index}
        </span>
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="pl-9">{children}</div>
    </section>
  );
}

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v || 0)));

export function NewProductionPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const { data: settings } = useSettings();
  const { data: key } = useKeyStatus();
  const characters = useCharacters(false);
  const { data: productions } = useProductions();
  const generation = useGeneration();

  const [selected, setSelected] = useState<string[]>(() => params.get("characters")?.split(",").filter(Boolean) ?? []);
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState<ComedyStyle>("mixed");
  const [target, setTarget] = useState(30);
  const [clipDuration, setClipDuration] = useState(10);
  const [lang, setLang] = useState("fr");
  const [promptLang, setPromptLang] = useState<PromptLanguage>("en");
  const [musicMode, setMusicMode] = useState<MusicMode>("flow");
  const [instructions, setInstructions] = useState("");
  const [continuityId, setContinuityId] = useState("none");
  const [inventCharacters, setInventCharacters] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (settings && !initialized) {
      setStyle(settings.defaultComedyStyle);
      setTarget(settings.defaultTargetDuration);
      setClipDuration(settings.defaultClipDuration);
      setLang(settings.defaultLanguage);
      setPromptLang(settings.promptLanguage);
      setMusicMode(settings.musicMode);
      setInitialized(true);
    }
  }, [settings, initialized]);

  // Ignore les personnages preselectionnes qui n'existent plus / sont archives.
  useEffect(() => {
    if (characters.data) setSelected((s) => s.filter((id) => characters.data.some((c) => c.id === id)));
  }, [characters.data]);

  const clipCount = computeClipCount(target, clipDuration);
  const selectedCharacters = useMemo(
    () => selected.map((id) => characters.data?.find((c) => c.id === id)).filter((c) => c !== undefined),
    [selected, characters.data],
  );
  const withoutImages = selectedCharacters.filter((c) => c.imageCount === 0);
  const canGenerate = selected.length > 0 && !generation.running && Boolean(settings);

  const generate = async () => {
    if (!canGenerate || !settings) return;
    try {
      const result = await generation.run(async ({ signal, onPhase }) => {
        const details = await Promise.all(
          selected.map((id) => client.fetchQuery({ queryKey: qk.character(id), queryFn: () => charactersApi.get(id), staleTime: 0 })),
        );
        const continuity = continuityId !== "none" ? continuityFrom(await productionsApi.get(continuityId)) : null;
        const generated = await generateProduction(
          {
            title,
            characters: details,
            storyIdea: idea,
            comedyStyle: style,
            targetDuration: target,
            clipDuration,
            language: lang,
            promptLanguage: promptLang,
            musicMode,
            additionalInstructions: instructions,
            inventCharacters,
            continuity,
            model: settings.geminiModel,
          },
          { signal, onPhase },
        );
        return productionsApi.create({
          title: generated.title,
          synopsis: generated.synopsis,
          targetDuration: target,
          clipDuration,
          params: { ...generated.params, continuityProductionId: continuityId !== "none" ? continuityId : null },
          story: generated.story,
          characterIds: selected,
          clips: generated.clips,
        });
      });
      if (result) {
        invalidate(client, "productions", "stats", "characters");
        notifySuccess("Histoire générée", `${result.clips.length} clips prêts à copier dans Google Flow.`);
        navigate(`/productions/${result.id}`);
      }
    } catch {
      // L'erreur est affichee dans le recapitulatif (GenerationErrorNotice).
    }
  };

  useHotkeys([{ combo: "mod+enter", handler: () => void generate(), allowInInputs: true }]);

  const busy = generation.running;

  return (
    <Page wide className="pb-16">
      <PageHeader
        back={{ to: "/productions", label: "Productions" }}
        title="Nouvelle production"
        description="Une production = une histoire complète, découpée en clips connectés. Sélectionnez vos personnages et cliquez sur Générer : le reste est optionnel."
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-9">
          <Step index={1} title="Casting" description="Les fiches complètes (personnalité, voix, apparence, relations) sont envoyées à Gemini.">
            {characters.isLoading ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : (
              <div className="flex flex-col gap-3">
                <CharacterPicker characters={characters.data ?? []} selected={selected} onChange={setSelected} disabled={busy} />
                <InventCharactersOption onChange={setInventCharacters} disabled={busy} />
              </div>
            )}
          </Step>

          <Step index={2} title="Histoire" description="Facultatif : laissez vide et Gemini invente une histoire originale.">
            <div className="flex flex-col gap-4">
              <Field label="Titre de travail" hint="Laissez vide pour un titre proposé par Gemini.">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. La grande trahison du compotier" disabled={busy} maxLength={120} />
              </Field>
              <Field label="Idée de départ" aside={<DictationButton field="idée de départ" disabled={busy} value={idea} onChange={setIdea} />}>
                <Textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  disabled={busy}
                  className="min-h-24"
                  placeholder="Ex. Banane découvre que Pomme a liké la photo de Kiwi… en pleine soirée raclette."
                />
              </Field>
              <Field label="Style comique">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
                  {COMEDY_STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      disabled={busy}
                      aria-pressed={style === s.value}
                      onClick={() => setStyle(s.value)}
                      className={cn(
                        "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color]",
                        style === s.value ? "border-primary/70 bg-lime-soft ring-1 ring-primary/40" : "border-border bg-surface/60 hover:border-muted-foreground/40",
                      )}
                    >
                      <span className="text-[13px] font-medium">{s.label}</span>
                      <span className="text-[11.5px] leading-snug text-muted-foreground">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Step>

          <Step index={3} title="Format" description="Chaque clip est généré séparément dans Google Flow, puis assemblé automatiquement.">
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Durée cible" hint={`Entre ${MIN_TARGET_DURATION} et ${MAX_TARGET_DURATION} secondes.`}>
                  <div className="flex gap-1.5">
                    {TARGET_PRESETS.map((p) => (
                      <Button key={p} type="button" size="sm" variant={target === p ? "secondary" : "ghost"} className={cn(target === p && "ring-1 ring-border")} onClick={() => setTarget(p)} disabled={busy}>
                        {p} s
                      </Button>
                    ))}
                    <Input
                      type="number"
                      min={MIN_TARGET_DURATION}
                      max={MAX_TARGET_DURATION}
                      value={target}
                      disabled={busy}
                      onChange={(e) => setTarget(clampInt(Number(e.target.value), MIN_TARGET_DURATION, MAX_TARGET_DURATION))}
                      className="h-8 w-20"
                      aria-label="Durée cible personnalisée"
                    />
                  </div>
                </Field>
                <Field label="Durée d'un clip" hint="Réglez-la sur la durée réellement générée par Flow (souvent 8 s avec Veo).">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={MIN_CLIP_DURATION}
                      max={MAX_CLIP_DURATION}
                      value={clipDuration}
                      disabled={busy}
                      onChange={(e) => setClipDuration(clampInt(Number(e.target.value), MIN_CLIP_DURATION, MAX_CLIP_DURATION))}
                      className="h-8 w-20"
                    />
                    <span className="text-[12.5px] text-muted-foreground">secondes</span>
                  </div>
                </Field>
              </div>
              <ClipTimeline clipCount={clipCount} clipDuration={clipDuration} />
              <p className="text-[12.5px] text-muted-foreground">
                <span className="font-medium text-foreground">{clipCount} clips</span> de {clipDuration} s = {formatSeconds(clipCount * clipDuration)} au total.
              </p>
            </div>
          </Step>

          <Step index={4} title="Langue & audio">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Langue des dialogues">
                <Select value={lang} onValueChange={setLang} disabled={busy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Langue des prompts Flow">
                <Select value={promptLang} onValueChange={(v) => setPromptLang(v as PromptLanguage)} disabled={busy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en" hint="Dialogues conservés dans leur langue">
                      Anglais (recommandé pour Veo)
                    </SelectItem>
                    <SelectItem value="story">Langue de l'histoire</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Musique de fond">
                <Select value={musicMode} onValueChange={(v) => setMusicMode(v as MusicMode)} disabled={busy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flow" hint="Les prompts imposent une musique continue">
                      Générée par Flow
                    </SelectItem>
                    <SelectItem value="post" hint="Prompts sans musique, piste unique au montage">
                      Ajoutée au montage
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Step>

          <Step index={5} title="Options avancées">
            <div className="flex flex-col gap-4">
              <Field label="Instructions supplémentaires">
                <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={busy} placeholder="Ex. Décor : un frigo la nuit. Pas plus de deux répliques par clip." />
              </Field>
              <Field label="Continuité" hint="Par défaut, chaque production est une histoire indépendante.">
                <Select value={continuityId} onValueChange={setContinuityId} disabled={busy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune — histoire indépendante</SelectItem>
                    {(productions ?? [])
                      .filter((p) => p.clipCount > 0)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id} hint="Suite de cette production">
                          {p.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Step>
        </div>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <Card className="flex flex-col gap-5 p-5">
            <div className="flex items-center gap-2">
              <Wand2 className="size-4 text-primary-strong" />
              <h2 className="text-[14px] font-semibold">Récapitulatif</h2>
            </div>
            <dl className="flex flex-col gap-3 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Casting</dt>
                <dd className="flex items-center gap-2">
                  {selectedCharacters.length ? <AvatarStack characters={selectedCharacters} size={24} max={6} /> : <span className="text-muted-foreground">—</span>}
                  {inventCharacters && <span className="font-medium">+ fruits au hasard</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Style</dt>
                <dd className="text-right font-medium">{comedyStyle(style).label}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Format</dt>
                <dd className="font-medium">
                  {clipCount} × {clipDuration} s · 9:16
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Modèle</dt>
                <dd className="truncate font-mono text-[11.5px]">{settings?.geminiModel ?? "…"}</dd>
              </div>
            </dl>
            <Separator />

            {key && !key.configured && (
              <InlineNotice tone="warning" icon={KeyRound} title="Clé API Gemini manquante">
                <Link to="/settings#gemini" className="text-primary-strong underline-offset-2 hover:underline">
                  Ajoutez votre clé
                </Link>{" "}
                (gratuite sur Google AI Studio) pour générer des histoires.
              </InlineNotice>
            )}
            {withoutImages.length > 0 && (
              <InlineNotice icon={ImageOff}>
                {withoutImages.map((c) => c.name).join(", ")} {withoutImages.length > 1 ? "n'ont" : "n'a"} pas d'image de référence : la description écrite sera la seule source visuelle.
              </InlineNotice>
            )}

            {busy ? (
              <GenerationProgress phase={generation.phase} elapsed={generation.elapsed} onCancel={generation.cancel} />
            ) : generation.error ? (
              <GenerationErrorNotice error={generation.error} onRetry={() => void generate()} onDismiss={generation.clearError} />
            ) : null}

            <Button size="xl" className="w-full" onClick={() => void generate()} disabled={!canGenerate} loading={busy}>
              {!busy && <Sparkles />}
              {busy ? "Génération en cours…" : "Générer l'histoire"}
            </Button>
            <p className="-mt-2 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-muted-foreground">
              <Kbd>Ctrl Entrée</Kbd> · consomme 1 requête Gemini (2 si correction)
            </p>
            {selected.length === 0 && <p className="-mt-3 text-center text-[12px] text-orange">Sélectionnez au moins un personnage.</p>}
          </Card>
        </aside>
      </div>
    </Page>
  );
}
