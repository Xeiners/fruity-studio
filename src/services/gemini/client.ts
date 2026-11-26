/**
 * Client Gemini base sur le SDK officiel `@google/genai`.
 *
 * Securite : le SDK recoit une cle factice. Toutes ses requetes HTTP passent par
 * `proxyFetch`, qui les transmet a la commande Rust `gemini_http`. C'est Rust
 * qui lit la vraie cle dans le Gestionnaire d'identification Windows et l'ajoute
 * a la requete : la cle n'entre jamais dans le contexte JavaScript.
 */
import { GoogleGenAI, ThinkingLevel, type Model } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_GEMINI_MODEL } from "@/utils/catalog";
import { toGeminiError } from "./errors";

/** Valeur factice : remplacee par la vraie cle cote Rust. */
const PLACEHOLDER_KEY = "managed-by-fruity-studio-native-keyring";

interface ProxyResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Requête annulée", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Requête annulée", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const headers: [string, string][] = [];
  new Headers(init?.headers ?? request?.headers).forEach((value, name) => headers.push([name, value]));
  let body: string | undefined;
  if (init?.body != null) {
    body = typeof init.body === "string" ? init.body : await new Response(init.body).text();
  } else if (request && method !== "GET" && method !== "HEAD") {
    body = await request.text();
  }
  const res = await abortable(
    invoke<ProxyResponse>("gemini_http", { request: { method, url, headers, body } }),
    init?.signal ?? request?.signal,
  );
  const noBody = res.status === 204 || res.status === 304;
  return new Response(noBody ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: PLACEHOLDER_KEY,
      httpOptions: { fetch: proxyFetch },
    });
  }
  return client;
}

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  thinking: boolean;
}

const EXCLUDED = /(tts|image|imagen|live|embedding|embed|audio|robotics|computer-use|veo|aqa|learnlm|gemma|nano|banana)/i;

function toInfo(model: Model): GeminiModelInfo | null {
  const id = (model.name ?? "").replace(/^models\//, "");
  if (!id.startsWith("gemini") || EXCLUDED.test(id)) return null;
  if (model.supportedActions && !model.supportedActions.includes("generateContent")) return null;
  return {
    id,
    displayName: model.displayName ?? id,
    description: model.description ?? "",
    inputTokenLimit: model.inputTokenLimit ?? null,
    outputTokenLimit: model.outputTokenLimit ?? null,
    thinking: Boolean(model.thinking),
  };
}

const MODEL_CACHE_MS = 5 * 60_000;
const MODEL_LIST_LIMIT_MS = 10_000;
let modelCache: { at: number; models: GeminiModelInfo[] } | null = null;

/** Liste les modeles Gemini capables de generer du texte pour cette cle. */
export async function listTextModels(): Promise<GeminiModelInfo[]> {
  try {
    const pager = await getGeminiClient().models.list({ config: { pageSize: 100, queryBase: true } });
    const models: GeminiModelInfo[] = [];
    for await (const model of pager) {
      const info = toInfo(model);
      if (info) models.push(info);
    }
    models.sort((a, b) => rankModel(b.id) - rankModel(a.id) || a.id.localeCompare(b.id));
    modelCache = { at: Date.now(), models };
    return models;
  } catch (error) {
    throw toGeminiError(error);
  }
}

/** Nombre maximal de modeles essayes pour une meme generation (protege le quota gratuit). */
export const MAX_MODEL_ATTEMPTS = 4;

/** `fast` : textes courts, ou la rapidite compte plus que la reflexion. */
export type GenerationSpeed = "fast" | "standard";

const SLOW_MODELS_KEY = "fruity-slow-models";
const SLOW_MODEL_MS = 24 * 3_600_000;

function readSlowModels(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SLOW_MODELS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSlowModels(models: Record<string, number>) {
  try {
    localStorage.setItem(SLOW_MODELS_KEY, JSON.stringify(models));
  } catch {
    /* stockage indisponible : le modele sera simplement retente */
  }
}

/** Un modele qui n'a pas repondu a temps est evite pendant 24 h. */
export function markModelSlow(id: string) {
  writeSlowModels({ ...readSlowModels(), [id]: Date.now() + SLOW_MODEL_MS });
}

export function markModelResponsive(id: string) {
  const { [id]: _responsive, ...others } = readSlowModels();
  writeSlowModels(others);
}

export function isModelSlow(id: string): boolean {
  return (readSlowModels()[id] ?? 0) > Date.now();
}

/**
 * Ordre d'essai : le modele choisi s'il est disponible, puis un Flash-Lite stable (une autre
 * gamme, souvent moins encombree), puis les mieux classes. Les modeles trop lents passent en dernier.
 */
export function buildModelChain(preferred: string, models: GeminiModelInfo[], isSlow: (id: string) => boolean = () => false, max = MAX_MODEL_ATTEMPTS): string[] {
  const ids = models.map((m) => m.id);
  const ordered = ids.includes(preferred) ? [preferred, ...ids.filter((id) => id !== preferred)] : ids;
  const lite = ordered.slice(1).find((id) => /flash-lite/.test(id) && !/preview|exp|latest/.test(id));
  const chain = lite ? [ordered[0], lite, ...ordered.slice(1).filter((id) => id !== lite)] : ordered;
  const usable = [...chain.filter((id) => !isSlow(id)), ...chain.filter(isSlow)];
  return usable.length > 0 ? usable.slice(0, max) : [preferred];
}

/** Niveau de reflexion rapide. Flash-Lite y est deja par defaut, et les 2.5 n'ont pas ce reglage. */
export function fastThinkingLevel(model: string): ThinkingLevel | null {
  if (/flash-lite/.test(model)) return null;
  const version = Number.parseFloat(model.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  return version >= 3 ? ThinkingLevel.LOW : null;
}

/** Detecte les modeles reellement proposes a cette cle (liste gardee 5 minutes). */
export async function resolveModelChain(preferred: string): Promise<string[]> {
  try {
    const fresh = modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS;
    const models = fresh
      ? modelCache!.models
      : await Promise.race([listTextModels(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("liste trop lente")), MODEL_LIST_LIMIT_MS))]);
    return buildModelChain(preferred, models, isModelSlow);
  } catch {
    // Liste indisponible : la derniere connue garde les modeles de secours. La requete remontera l'erreur exacte.
    return buildModelChain(preferred, modelCache?.models ?? [], isModelSlow);
  }
}

/** Classement : Flash stable recent d'abord, puis Flash-Lite, puis le reste. */
export function rankModel(id: string): number {
  const version = Number.parseFloat(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  let score = version * 10;
  if (/flash/.test(id) && !/lite/.test(id)) score += 1000;
  else if (/flash-lite/.test(id)) score += 500;
  if (/preview|exp|latest/.test(id)) score -= 300;
  return score;
}

/** Choisit un modele par defaut sensé parmi ceux disponibles. */
export function pickDefaultModel(models: GeminiModelInfo[], preferred = DEFAULT_GEMINI_MODEL): string {
  if (models.some((m) => m.id === preferred)) return preferred;
  return models[0]?.id ?? preferred;
}

export interface ConnectionTestResult {
  ok: boolean;
  models: GeminiModelInfo[];
  modelAvailable: boolean;
  suggestedModel: string;
  sample: string | null;
  latencyMs: number;
}

/** Teste la cle (liste des modeles) puis le modele choisi (1 requete tres courte). */
export async function testConnection(model: string): Promise<ConnectionTestResult> {
  const started = performance.now();
  const models = await listTextModels();
  const modelAvailable = models.some((m) => m.id === model);
  const suggestedModel = modelAvailable ? model : pickDefaultModel(models);
  let sample: string | null = null;
  try {
    const response = await getGeminiClient().models.generateContent({
      model: suggestedModel,
      contents: "Réponds uniquement par : OK",
    });
    sample = response.text?.trim() ?? null;
  } catch (error) {
    throw toGeminiError(error);
  }
  return {
    ok: true,
    models,
    modelAvailable,
    suggestedModel,
    sample,
    latencyMs: Math.round(performance.now() - started),
  };
}
