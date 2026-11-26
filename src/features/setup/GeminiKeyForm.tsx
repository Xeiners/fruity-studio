import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Gauge, KeyRound, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useConfirm } from "@/components/common/ConfirmDialog";
import { InlineNotice } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form-controls";
import { qk, useKeyStatus, useSettings } from "@/hooks/queries";
import { testConnection, type ConnectionTestResult } from "@/services/gemini/client";
import { GeminiError, toGeminiError } from "@/services/gemini/errors";
import { errorMessage } from "@/services/storage/invoke";
import { secretsApi, settingsApi } from "@/services/storage/system";
import { notifyError } from "@/utils/notify";

/**
 * Saisie de la cle API Gemini : enregistrement dans le Gestionnaire
 * d'identification Windows puis test immediat (liste des modeles + 1 requete
 * courte). Une cle refusee par Google est retiree automatiquement.
 */
export function GeminiKeyForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const { data: key, isLoading } = useKeyStatus();
  const { data: settings } = useSettings();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<"saving" | "testing" | null>(null);
  const [result, setResult] = useState<(ConnectionTestResult & { switchedFrom?: string }) | null>(null);
  const [error, setError] = useState<GeminiError | string | null>(null);

  const runTest = async () => {
    if (!settings) return;
    setBusy("testing");
    setResult(null);
    setError(null);
    try {
      const res = await testConnection(settings.geminiModel);
      if (!res.modelAvailable && res.suggestedModel !== settings.geminiModel) {
        // Modele par defaut indisponible pour cette cle : on bascule sur un modele valide.
        const saved = await settingsApi.update({ ...settings, geminiModel: res.suggestedModel });
        client.setQueryData(qk.settings, saved);
        setResult({ ...res, switchedFrom: settings.geminiModel });
      } else {
        setResult(res);
      }
    } catch (e) {
      const ge = toGeminiError(e);
      if (ge.code === "invalid_key") {
        client.setQueryData(qk.keyStatus, await secretsApi.clear().catch(() => key));
      }
      setError(ge);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy("saving");
    setResult(null);
    setError(null);
    try {
      client.setQueryData(qk.keyStatus, await secretsApi.set(trimmed));
      setValue("");
      setVisible(false);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      return;
    }
    await runTest();
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Supprimer la clé API ?",
      description: "Elle sera retirée du Gestionnaire d'identification Windows. La génération d'histoires sera désactivée jusqu'à l'ajout d'une nouvelle clé.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      client.setQueryData(qk.keyStatus, await secretsApi.clear());
      setResult(null);
      setError(null);
    } catch (e) {
      notifyError(e);
    }
  };

  if (isLoading) return <Skeleton className="h-20 rounded-lg" />;

  return (
    <div className="flex flex-col gap-3">
      {key?.configured && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-[12.5px]">
          <ShieldCheck className="size-4 text-success" />
          <span className="font-medium">Clé enregistrée</span>
          <span className="font-mono text-muted-foreground">{key.hint}</span>
          <span className="text-muted-foreground">· {key.storage}</span>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="xs" onClick={() => void runTest()} loading={busy === "testing"} disabled={busy !== null}>
              <Gauge /> Tester
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void remove()} disabled={busy !== null}>
              <Trash2 /> Supprimer
            </Button>
          </div>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Input
            type={visible ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={key?.configured ? "Remplacer par une nouvelle clé…" : "Collez votre clé API ici (AIza…)"}
            className="pr-9 font-mono text-[12.5px]"
            aria-label="Clé API Gemini"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={visible ? "Masquer la clé" : "Afficher la clé"}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button type="submit" disabled={!value.trim() || busy !== null} loading={busy === "saving"}>
          <KeyRound /> Enregistrer et tester
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" size="sm" type="button" onClick={() => void openUrl("https://aistudio.google.com/apikey")}>
          Obtenir une clé gratuite sur Google AI Studio <ExternalLink className="size-3" />
        </Button>
        <span className="text-[11.5px] text-muted-foreground">Stockée chiffrée par Windows, jamais affichée ni journalisée.</span>
      </div>

      {busy === "testing" && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Gauge className="size-4 animate-pulse" /> Test de la connexion à Gemini…
        </p>
      )}
      {result && (
        <InlineNotice tone="success" icon={CheckCircle2} title="Connexion réussie">
          {result.switchedFrom ? (
            <>
              Le modèle « {result.switchedFrom} » n'est pas proposé à cette clé : Fruity Studio utilise désormais{" "}
              <span className="font-mono">{result.suggestedModel}</span>.
            </>
          ) : (
            <>
              Le modèle <span className="font-mono">{result.suggestedModel}</span> répond ({result.latencyMs} ms).
            </>
          )}{" "}
          {result.models.length} modèles texte disponibles.
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="danger" icon={XCircle} title={error instanceof GeminiError ? error.title : "Enregistrement impossible"}>
          {error instanceof GeminiError ? error.message : error}
          {error instanceof GeminiError && error.code === "invalid_key" && " La clé refusée a été retirée."}
        </InlineNotice>
      )}
    </div>
  );
}
