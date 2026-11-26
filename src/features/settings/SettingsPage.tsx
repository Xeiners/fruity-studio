import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  Cpu,
  ExternalLink,
  FolderOpen,
  Gauge,
  HardDrive,
  KeyRound,
  Laptop,
  ListRestart,
  Moon,
  Palette,
  RefreshCw,
  Sun,
  TerminalSquare,
  Wand2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/common/PageHeader";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/menus";
import { qk, useAppInfo, useKeyStatus, useSettings, useUpdateSettings } from "@/hooks/queries";
import { useSetTheme } from "@/hooks/useSetTheme";
import { useTheme } from "@/hooks/useTheme";
import { ffmpegApi } from "@/services/ffmpeg";
import { listTextModels, pickDefaultModel, testConnection, type ConnectionTestResult, type GeminiModelInfo } from "@/services/gemini/client";
import { GeminiError, QUOTA_EXPLANATION, toGeminiError } from "@/services/gemini/errors";
import { systemApi } from "@/services/storage/system";
import type { AppSettings, ComedyStyle, MusicMode, PromptLanguage, ThemePreference } from "@/types";
import { COMEDY_STYLES, FRAME_RATES, LANGUAGES, RESOLUTIONS } from "@/utils/catalog";
import { MAX_CLIP_DURATION, MAX_TARGET_DURATION, MIN_CLIP_DURATION, MIN_TARGET_DURATION } from "@/utils/clips";
import { cn } from "@/utils/cn";
import { notifyError, notifySuccess } from "@/utils/notify";
import { FfmpegInstaller } from "@/features/setup/FfmpegInstaller";
import { GeminiKeyForm } from "@/features/setup/GeminiKeyForm";
import { openSetup } from "@/features/setup/setupStore";

function Section({ id, icon: Icon, title, description, children }: { id: string; icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={id} className="grid scroll-mt-6 gap-6 p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-primary-strong">
          <Icon className="size-4" strokeWidth={1.75} />
        </div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </Card>
  );
}

function GeminiSection({ draft, setDraft }: { draft: AppSettings; setDraft: (patch: Partial<AppSettings>) => void }) {
  const { data: key } = useKeyStatus();
  const [models, setModels] = useState<GeminiModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [testError, setTestError] = useState<GeminiError | null>(null);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      setModels(await listTextModels());
    } catch (e) {
      setTestError(toGeminiError(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setTestError(null);
    try {
      const result = await testConnection(draft.geminiModel);
      setTest(result);
      setModels(result.models);
    } catch (e) {
      setTestError(toGeminiError(e));
    } finally {
      setTesting(false);
    }
  };

  const modelOptions = models ?? [];
  const inList = modelOptions.some((m) => m.id === draft.geminiModel);

  return (
    <>
      <Field label="Clé API Gemini">
        <GeminiKeyForm />
      </Field>

      <Field
        label="Modèle"
        hint="Un modèle Flash offre le meilleur rapport qualité / rapidité / quota. La liste réelle vient de l'API : aucun nom n'est imposé."
        aside={
          <Button variant="ghost" size="xs" onClick={() => void loadModels()} loading={loadingModels} disabled={!key?.configured}>
            <ListRestart /> Charger la liste
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Select value={inList ? draft.geminiModel : "__custom"} onValueChange={(v) => v !== "__custom" && setDraft({ geminiModel: v })} disabled={modelOptions.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder="Chargez la liste des modèles" />
            </SelectTrigger>
            <SelectContent>
              {!inList && <SelectItem value="__custom">{draft.geminiModel} (saisi)</SelectItem>}
              {modelOptions.map((m) => (
                <SelectItem key={m.id} value={m.id} hint={m.displayName !== m.id ? m.displayName : undefined}>
                  {m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={draft.geminiModel} onChange={(e) => setDraft({ geminiModel: e.target.value })} className="font-mono text-[12.5px]" aria-label="Identifiant du modèle" />
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void runTest()} loading={testing} disabled={!key?.configured}>
          <Gauge /> Tester la connexion
        </Button>
        <span className="text-[12px] text-muted-foreground">Vérifie la clé, liste les modèles et envoie 1 requête très courte au modèle choisi.</span>
      </div>
      {test && (
        <InlineNotice tone={test.modelAvailable ? "success" : "warning"} icon={test.modelAvailable ? CheckCircle2 : XCircle} title={test.modelAvailable ? "Connexion réussie" : "Clé valide, mais modèle introuvable"}>
          {test.modelAvailable ? (
            <>
              Le modèle <span className="font-mono">{draft.geminiModel}</span> répond ({test.latencyMs} ms). {test.models.length} modèles texte disponibles.
            </>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              « {draft.geminiModel} » n'est pas proposé à cette clé. Suggestion : <span className="font-mono">{test.suggestedModel}</span>
              <Button size="xs" onClick={() => setDraft({ geminiModel: test.suggestedModel })}>
                Utiliser ce modèle
              </Button>
            </span>
          )}
        </InlineNotice>
      )}
      {testError && (
        <InlineNotice tone="danger" icon={XCircle} title={testError.title}>
          {testError.message}
          {testError.code === "model_not_found" && models && (
            <Button size="xs" className="mt-2" onClick={() => setDraft({ geminiModel: pickDefaultModel(models) })}>
              Utiliser {pickDefaultModel(models)}
            </Button>
          )}
        </InlineNotice>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-2 text-[12.5px] font-semibold">Quotas du niveau gratuit</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
          {QUOTA_EXPLANATION.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Button variant="link" size="sm" className="mt-2" onClick={() => void openUrl("https://aistudio.google.com/rate-limit")}>
          Consulter mes limites dans AI Studio <ExternalLink className="size-3" />
        </Button>
      </div>
    </>
  );
}

function FfmpegSection({
  customPath,
  onCustomPath,
  beforeDetect,
}: {
  customPath: string;
  onCustomPath: (path: string) => void;
  /** Enregistre le chemin personnalise avant la detection (lue cote Rust). */
  beforeDetect: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [detecting, setDetecting] = useState(false);

  const detect = async () => {
    setDetecting(true);
    try {
      await beforeDetect();
      client.setQueryData(qk.ffmpeg, await ffmpegApi.detect(true));
    } catch (e) {
      notifyError(e, "Détection impossible");
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FfmpegInstaller />
      <Field label="Chemin personnalisé (facultatif)" hint="Fichier ffmpeg.exe ou son dossier. ffprobe.exe doit se trouver à côté. Vide = détection automatique.">
        <div className="flex gap-2">
          <Input value={customPath} onChange={(e) => onCustomPath(e.target.value)} placeholder="C:\ffmpeg\bin\ffmpeg.exe" className="font-mono text-[12.5px]" />
          <Button
            variant="outline"
            onClick={async () => {
              const file = await openDialog({ multiple: false, filters: [{ name: "ffmpeg", extensions: ["exe"] }], title: "Sélectionnez ffmpeg.exe" });
              if (typeof file === "string") onCustomPath(file);
            }}
          >
            <FolderOpen /> Parcourir
          </Button>
          <Button variant="outline" onClick={() => void detect()} loading={detecting}>
            <RefreshCw /> Détecter
          </Button>
        </div>
      </Field>
    </div>
  );
}

function FolderField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-[12px]" />
        <Button
          variant="outline"
          size="icon"
          aria-label="Choisir le dossier"
          onClick={async () => {
            const dir = await openDialog({ directory: true, defaultPath: value || undefined });
            if (typeof dir === "string") onChange(dir);
          }}
        >
          <FolderOpen />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => systemApi.reveal(value).catch((e) => notifyError(e, "Ouverture impossible"))}>
          Ouvrir
        </Button>
      </div>
    </Field>
  );
}

export function SettingsPage() {
  const location = useLocation();
  const { data: settings, isLoading } = useSettings();
  const { data: info } = useAppInfo();
  const update = useUpdateSettings();
  const { preference } = useTheme();
  const setTheme = useSetTheme();
  const [draft, setDraftState] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings && !draft) setDraftState(settings);
  }, [settings, draft]);

  // Le test de la clé peut basculer sur un modèle disponible : le brouillon suit.
  const savedModel = settings?.geminiModel;
  useEffect(() => {
    if (savedModel) setDraftState((d) => (d && d.geminiModel !== savedModel ? { ...d, geminiModel: savedModel } : d));
  }, [savedModel]);

  useEffect(() => {
    if (!location.hash || !draft) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, draft]);

  if (isLoading || !draft || !settings) {
    return (
      <Page>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 rounded-xl" />
      </Page>
    );
  }

  const setDraft = (patch: Partial<AppSettings>) => setDraftState((d) => (d ? { ...d, ...patch } : d));
  const dirty = JSON.stringify({ ...draft, theme: settings.theme }) !== JSON.stringify(settings);

  const save = () =>
    update.mutate(
      { ...draft, theme: settings.theme },
      {
        onSuccess: (saved) => {
          setDraftState(saved);
          notifySuccess("Paramètres enregistrés");
        },
        onError: (e) => notifyError(e, "Paramètres non enregistrés"),
      },
    );

  const resolution = `${draft.videoWidth}x${draft.videoHeight}`;
  const themes: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
    { value: "dark", label: "Sombre", icon: Moon },
    { value: "light", label: "Clair", icon: Sun },
    { value: "system", label: "Système", icon: Laptop },
  ];

  return (
    <Page className="max-w-[1080px] pb-28">
      <PageHeader
        title="Paramètres"
        description="Connexion Gemini, valeurs par défaut des productions, FFmpeg et dossiers de travail."
        actions={
          <Button variant="outline" onClick={openSetup}>
            <Wand2 /> Assistant de configuration
          </Button>
        }
      />

      <Section id="gemini" icon={KeyRound} title="Gemini" description="Génération des histoires et des prompts via le SDK officiel Google GenAI. La clé est injectée côté natif : elle n'est jamais exposée à l'interface.">
        <GeminiSection draft={draft} setDraft={setDraft} />
      </Section>

      <Section id="production" icon={Cpu} title="Productions" description="Valeurs proposées par défaut dans « Nouvelle production ».">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Langue des dialogues">
            <Select value={draft.defaultLanguage} onValueChange={(v) => setDraft({ defaultLanguage: v })}>
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
          <Field label="Langue des prompts Google Flow">
            <Select value={draft.promptLanguage} onValueChange={(v) => setDraft({ promptLanguage: v as PromptLanguage })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en" hint="Dialogues conservés dans leur langue">
                  Anglais (recommandé)
                </SelectItem>
                <SelectItem value="story">Langue de l'histoire</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Durée cible (s)" hint={`${MIN_TARGET_DURATION} à ${MAX_TARGET_DURATION} s`}>
            <Input type="number" min={MIN_TARGET_DURATION} max={MAX_TARGET_DURATION} value={draft.defaultTargetDuration} onChange={(e) => setDraft({ defaultTargetDuration: Number(e.target.value) })} />
          </Field>
          <Field label="Durée d'un clip (s)" hint="Veo dans Google Flow génère souvent des clips de 8 s.">
            <Input type="number" min={MIN_CLIP_DURATION} max={MAX_CLIP_DURATION} value={draft.defaultClipDuration} onChange={(e) => setDraft({ defaultClipDuration: Number(e.target.value) })} />
          </Field>
          <Field label="Style comique">
            <Select value={draft.defaultComedyStyle} onValueChange={(v) => setDraft({ defaultComedyStyle: v as ComedyStyle })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMEDY_STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Musique de fond">
            <Select value={draft.musicMode} onValueChange={(v) => setDraft({ musicMode: v as MusicMode })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flow">Générée par Flow (continuité demandée)</SelectItem>
                <SelectItem value="post">Ajoutée au montage</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section id="video" icon={TerminalSquare} title="Vidéo & rendu" description="Format d'export par défaut (TikTok : 1080 × 1920, 30 i/s, H.264 + AAC) et moteur FFmpeg.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Résolution par défaut">
            <Select
              value={resolution}
              onValueChange={(v) => {
                const [w, h] = v.split("x").map(Number);
                setDraft({ videoWidth: w, videoHeight: h });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r.label} value={`${r.width}x${r.height}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Images par seconde">
            <Select value={String(draft.frameRate)} onValueChange={(v) => setDraft({ frameRate: Number(v) })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRAME_RATES.map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f} i/s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <FfmpegSection
          customPath={draft.ffmpegPath ?? ""}
          onCustomPath={(p) => setDraft({ ffmpegPath: p || null })}
          beforeDetect={async () => {
            if ((draft.ffmpegPath ?? "") !== (settings.ffmpegPath ?? "")) {
              const saved = await update.mutateAsync({ ...settings, ffmpegPath: draft.ffmpegPath });
              setDraftState((d) => (d ? { ...d, ffmpegPath: saved.ffmpegPath } : d));
            }
          }}
        />
      </Section>

      <Section id="storage" icon={HardDrive} title="Stockage" description="Les médias importés sont copiés dans l'espace de travail (vos originaux ne sont jamais modifiés). Les métadonnées vivent dans une base SQLite locale.">
        <FolderField label="Espace de travail" hint="Changer de dossier s'applique aux nouveaux imports ; les fichiers existants restent à leur place." value={draft.workspaceDir} onChange={(v) => setDraft({ workspaceDir: v })} />
        <FolderField label="Dossier d'export" hint="Destination par défaut des vidéos finales et des références pour Flow." value={draft.exportDir} onChange={(v) => setDraft({ exportDir: v })} />
        {info && (
          <Field label="Base de données">
            <div className="flex gap-2">
              <Input readOnly value={info.databasePath} className="font-mono text-[12px] text-muted-foreground" />
              <Button variant="ghost" size="sm" onClick={() => systemApi.reveal(info.databasePath).catch((e) => notifyError(e))}>
                Afficher
              </Button>
            </div>
          </Field>
        )}
      </Section>

      <Section id="appearance" icon={Palette} title="Apparence" description="Thème de l'interface. Appliqué immédiatement.">
        <div className="grid max-w-md grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme(t.value)}
              aria-pressed={preference === t.value}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-[12.5px] font-medium transition-colors",
                preference === t.value ? "border-primary/70 bg-lime-soft ring-1 ring-primary/40" : "border-border hover:bg-accent/50",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      {info && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          Fruity Studio v{info.version} · schéma de base v{info.schemaVersion} · {info.dataDir}
        </p>
      )}

      {dirty && (
        <div className="fixed right-0 bottom-0 left-[248px] z-20 border-t border-border bg-background/90 backdrop-blur animate-rise">
          <div className="mx-auto flex max-w-[1080px] items-center justify-end gap-2 px-8 py-3 xl:px-10">
            <span className="mr-auto text-[12.5px] text-muted-foreground">Modifications non enregistrées</span>
            <Button variant="ghost" onClick={() => setDraftState(settings)}>
              Annuler
            </Button>
            <Button onClick={save} loading={update.isPending}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}
