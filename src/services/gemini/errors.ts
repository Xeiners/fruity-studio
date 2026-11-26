/**
 * Traduction des erreurs Gemini en messages clairs (francais), avec une
 * attention particuliere aux quotas du niveau gratuit.
 */
import { ApiError } from "@google/genai";

export type GeminiErrorCode =
  | "no_key"
  | "invalid_key"
  | "permission"
  | "quota"
  | "model_not_found"
  | "model_unsupported"
  | "overloaded"
  | "timeout"
  | "safety"
  | "invalid_output"
  | "network"
  | "cancelled"
  | "unknown";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly retryAfterSeconds: number | null;
  readonly dailyQuota: boolean;
  readonly details: string | null;

  constructor(
    code: GeminiErrorCode,
    message: string,
    options: { retryAfterSeconds?: number | null; dailyQuota?: boolean; details?: string | null } = {},
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.dailyQuota = options.dailyQuota ?? false;
    this.details = options.details ?? null;
  }

  /** Titre court pour les notifications. */
  get title(): string {
    switch (this.code) {
      case "no_key":
        return "Clé API manquante";
      case "invalid_key":
        return "Clé API invalide";
      case "permission":
        return "Accès refusé";
      case "quota":
        return this.dailyQuota ? "Quota journalier atteint" : "Limite de requêtes atteinte";
      case "model_not_found":
        return "Modèle indisponible";
      case "model_unsupported":
        return "Modèle incompatible";
      case "overloaded":
        return "Gemini surchargé";
      case "timeout":
        return "Délai dépassé";
      case "safety":
        return "Contenu bloqué";
      case "invalid_output":
        return "Réponse inexploitable";
      case "network":
        return "Connexion impossible";
      case "cancelled":
        return "Génération annulée";
      default:
        return "Erreur Gemini";
    }
  }

  get retryable(): boolean {
    return ["quota", "overloaded", "timeout", "network", "invalid_output", "unknown"].includes(this.code);
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<Record<string, unknown>>;
  };
}

function parseBody(message: string): GoogleErrorBody | null {
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(message.slice(start)) as GoogleErrorBody;
  } catch {
    return null;
  }
}

function retryDelaySeconds(details: Array<Record<string, unknown>>): number | null {
  for (const d of details) {
    const delay = d["retryDelay"];
    if (typeof delay === "string") {
      const n = Number.parseFloat(delay.replace(/s$/, ""));
      if (Number.isFinite(n)) return Math.ceil(n);
    }
  }
  return null;
}

function isDailyQuota(details: Array<Record<string, unknown>>, message: string): boolean {
  const text = JSON.stringify(details) + message;
  return /PerDay|per day|daily/i.test(text);
}

export function toGeminiError(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new GeminiError("cancelled", "La génération a été annulée.");
  }

  // Erreurs de la passerelle Rust (invoke) : { kind, message }
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    const e = error as { kind: string; message: string };
    if (e.kind === "network") return new GeminiError("network", e.message);
    return new GeminiError("unknown", e.message);
  }

  if (error instanceof ApiError || (error instanceof Error && "status" in error)) {
    const status = (error as ApiError).status;
    const body = parseBody(error.message);
    const apiStatus = body?.error?.status ?? "";
    const apiMessage = body?.error?.message ?? error.message;
    const details = body?.error?.details ?? [];
    const detailText = JSON.stringify(details);

    if (apiStatus === "NO_API_KEY") {
      return new GeminiError("no_key", "Aucune clé API Gemini n'est configurée. Ajoutez-la dans Paramètres › Gemini.");
    }
    if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(apiMessage + detailText)) {
      return new GeminiError(
        "invalid_key",
        "La clé API Gemini est refusée. Vérifiez-la dans Google AI Studio puis enregistrez-la à nouveau.",
        { details: apiMessage },
      );
    }
    if (status === 400 && /not supported|unsupported|does not support/i.test(apiMessage)) {
      return new GeminiError("model_unsupported", "Ce modèle ne prend pas en charge ce type de génération. Choisissez un autre modèle dans Paramètres › Gemini.", {
        details: apiMessage,
      });
    }
    if (status === 401 || status === 403) {
      return new GeminiError(
        "permission",
        "Accès refusé par l'API Gemini : la clé n'a pas les droits nécessaires (restriction de clé, API non activée ou région non prise en charge).",
        { details: apiMessage },
      );
    }
    if (status === 404) {
      return new GeminiError(
        "model_not_found",
        "Le modèle sélectionné n'existe pas ou n'est plus disponible. Choisissez un autre modèle dans Paramètres › Gemini.",
        { details: apiMessage },
      );
    }
    if (status === 429) {
      const retry = retryDelaySeconds(details);
      const daily = isDailyQuota(details, apiMessage);
      const message = daily
        ? "Le quota journalier gratuit de ce modèle est épuisé. Il se réinitialise à minuit (heure du Pacifique, soit 9 h du matin en France). Vous pouvez aussi choisir un autre modèle."
        : `Trop de requêtes en peu de temps : la limite par minute du niveau gratuit est atteinte.${retry ? ` Réessayez dans ${retry} s.` : " Patientez une minute puis réessayez."}`;
      return new GeminiError("quota", message, { retryAfterSeconds: retry, dailyQuota: daily, details: apiMessage });
    }
    if (status === 500 || status === 503) {
      return new GeminiError("overloaded", "Les serveurs Gemini sont momentanément surchargés. Réessayez dans quelques instants.", {
        details: apiMessage,
      });
    }
    if (status === 504) {
      return new GeminiError("timeout", "Gemini a mis trop de temps à répondre. Réessayez.", { details: apiMessage });
    }
    return new GeminiError("unknown", `Erreur Gemini (${status}) : ${apiMessage}`, { details: apiMessage });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new GeminiError("unknown", message || "Erreur inconnue lors de l'appel à Gemini.");
}

/** Explication des quotas affichee dans les Parametres. */
export const QUOTA_EXPLANATION = [
  "Le niveau gratuit de l'API Gemini est limité en requêtes par minute (RPM), en tokens par minute (TPM) et en requêtes par jour (RPD). Les valeurs exactes dépendent du modèle et évoluent : consultez-les dans Google AI Studio.",
  "Les limites s'appliquent par projet Google Cloud, pas par clé : plusieurs clés du même projet partagent le même quota.",
  "Le quota journalier se réinitialise à minuit, heure du Pacifique (9 h du matin en France).",
  "Une histoire ou une fiche de personnage consomme en général 1 requête (2 si une correction automatique est nécessaire). Régénérer un clip consomme 1 requête.",
  "Fruity Studio détecte les modèles proposés à votre clé. Si le modèle choisi est absent, saturé ou à court de quota, il passe au suivant (4 modèles au maximum par génération) et affiche celui qui a servi. Un modèle qui ne répond pas à temps est évité pendant 24 h.",
  "Après une erreur 429, le même modèle n'est jamais réessayé automatiquement. Si aucun modèle ne répond, Fruity Studio vous indique quand réessayer.",
];
