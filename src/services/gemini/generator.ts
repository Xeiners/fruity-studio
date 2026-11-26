/**
 * Generation d'histoires et regeneration de clips avec Gemini.
 * Sortie JSON contrainte par schema + validation Zod + une tentative de
 * correction automatique si la reponse est incomplete.
 */
import { FinishReason, type Content } from "@google/genai";
import { toast } from "sonner";
import type { CharacterDetail, CharacterGenerationInput, ClipInput, ProductionDetail, ProductionParams, PromptLanguage } from "@/types";
import { pickSupportingFruits } from "@/utils/catalog";
import { computeClipCount } from "@/utils/clips";
import { fastThinkingLevel, getGeminiClient, isModelSlow, markModelResponsive, markModelSlow, resolveModelChain, type GenerationSpeed } from "./client";
import { GeminiError, toGeminiError, type GeminiErrorCode } from "./errors";
import { composeCharacterModelSheetPrompt, composeFlowPrompt, finalizePublishKit } from "./flowPrompt";
import {
  buildCharacterPrompt,
  buildCharacterSystemInstruction,
  buildClipPrompt,
  buildPublishPrompt,
  buildPublishSystemInstruction,
  buildRepairPrompt,
  buildStoryPrompt,
  buildSystemInstruction,
  resolvePromptLanguage,
  type CharacterBriefRequest,
  type ContinuityContext,
  type PublishSource,
  type StoryRequest,
} from "./prompts";
import {
  MODEL_SHEET_KEY,
  activeCharacterIdentity,
  characterJsonSchema,
  clipJsonSchema,
  parseClipContent,
  productionJsonSchema,
  publishCopyJsonSchema,
  validateClip,
  validatePublishCopy,
  validateCharacterIdentity,
  validateStory,
  type CharacterDescriptor,
  type ClipContent,
  type PublishKit,
  type StoryContent,
  type ValidationResult,
} from "./schemas";

export type GenerationPhase = "writing" | "repairing" | "finalizing";

export interface GenerationCallbacks {
  signal?: AbortSignal;
  onPhase?: (phase: GenerationPhase) => void;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* traite plus bas */
      }
    }
    return undefined;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Requête annulée", "AbortError"));
      },
      { once: true },
    );
  });

interface StructuredRequest<T> {
  model: string;
  systemInstruction: string;
  prompt: string;
  jsonSchema: unknown;
  validate: (raw: unknown) => ValidationResult<T>;
  /** Ce qui est genere, pour le message d'erreur (par defaut « une histoire »). */
  subject?: string;
  speed?: GenerationSpeed;
}

/** Attente maximale pour un modele, puis pour toute la generation. */
const TIME_LIMITS: Record<GenerationSpeed, { perModel: number; total: number }> = {
  fast: { perModel: 30_000, total: 75_000 },
  standard: { perModel: 60_000, total: 150_000 },
};

/** Une tentative annulee soit par l'utilisateur, soit par le delai. */
function timedAttempt(parent: AbortSignal | undefined, limitMs: number) {
  const controller = new AbortController();
  let expired = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => {
    expired = true;
    abort();
  }, limitMs);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

/** Erreurs propres a un modele : un autre modele peut reussir. */
const NEXT_MODEL_CODES: ReadonlySet<GeminiErrorCode> = new Set(["model_not_found", "model_unsupported", "quota", "overloaded", "timeout"]);

/** Essaie les modeles dans l'ordre et renvoie le resultat avec le modele qui a servi. */
export async function runWithModelFallback<T>(
  chain: string[],
  attempt: (model: string) => Promise<T>,
  onSwitch: (from: string, to: string, error: GeminiError) => void = () => {},
  signal?: AbortSignal,
  deadline = Number.POSITIVE_INFINITY,
): Promise<{ data: T; model: string }> {
  for (const [index, model] of chain.entries()) {
    try {
      return { data: await attempt(model), model };
    } catch (error) {
      const e = toGeminiError(error);
      if (!NEXT_MODEL_CODES.has(e.code) || signal?.aborted) throw e;
      const next = chain[index + 1];
      if (next && Date.now() < deadline) {
        onSwitch(model, next, e);
        continue;
      }
      if (index === 0) throw e;
      const tried = chain.slice(0, index + 1);
      throw new GeminiError(e.code, `Aucun des ${tried.length} modèles essayés n'a pu répondre (${tried.join(", ")}). ${e.message}`, {
        retryAfterSeconds: e.retryAfterSeconds,
        dailyQuota: e.dailyQuota,
        details: e.details,
      });
    }
  }
  throw new GeminiError("model_not_found", "Aucun modèle Gemini n'est disponible pour cette clé.");
}

/**
 * Detecte les modeles disponibles pour cette cle, puis genere avec le premier
 * qui repond. L'utilisateur voit toujours quand un autre modele prend le relais.
 */
async function generateWithAvailableModel<T>(req: StructuredRequest<T>, cb: GenerationCallbacks): Promise<{ data: T; model: string }> {
  const speed = req.speed ?? "standard";
  const deadline = Date.now() + TIME_LIMITS[speed].total;
  const chain = await resolveModelChain(req.model);
  if (chain[0] !== req.model) {
    const reason = isModelSlow(req.model) ? "ne répond pas assez vite en ce moment" : "n'est pas proposé à votre clé";
    toast.info(`« ${req.model} » ${reason}`, { description: `Utilisation de ${chain[0]}.` });
  }
  return runWithModelFallback(
    chain,
    async (model) => {
      const data = await generateStructured({ ...req, model }, cb);
      markModelResponsive(model);
      return data;
    },
    (from, to, error) => toast.info(`${from} : ${error.title.toLowerCase()}`, { description: `Nouvel essai avec ${to}.` }),
    cb.signal,
    deadline,
  );
}

/**
 * Appel Gemini en sortie JSON. Une surcharge (503/500) est retentee une fois :
 * un autre modele repond souvent aussitot. Un modele trop lent est abandonne au
 * bout du delai, et une erreur de quota (429) n'est jamais retentee sur le meme modele.
 */
async function generateStructured<T>(req: StructuredRequest<T>, cb: GenerationCallbacks): Promise<T> {
  const ai = getGeminiClient();
  const contents: Content[] = [{ role: "user", parts: [{ text: req.prompt }] }];
  let lastIssues: string[] = [];
  const speed = req.speed ?? "standard";
  let thinkingLevel = speed === "fast" ? fastThinkingLevel(req.model) : null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    cb.onPhase?.(attempt === 0 ? "writing" : "repairing");
    let response;
    for (let transient = 0; ; transient += 1) {
      const call = timedAttempt(cb.signal, TIME_LIMITS[speed].perModel);
      try {
        response = await ai.models.generateContent({
          model: req.model,
          contents,
          config: {
            systemInstruction: req.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            abortSignal: call.signal,
            ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
          },
        });
        break;
      } catch (error) {
        if (call.timedOut()) {
          markModelSlow(req.model);
          throw new GeminiError("timeout", "Gemini a mis trop de temps à répondre. Réessayez dans un instant.");
        }
        const e = toGeminiError(error);
        // Chaque modele accepte des niveaux differents : on repart sans ce reglage plutot que d'echouer.
        if (thinkingLevel && /thinking/i.test(e.details ?? e.message)) {
          thinkingLevel = null;
          continue;
        }
        if (e.code === "overloaded" && transient < 1 && !cb.signal?.aborted) {
          await sleep(1500, cb.signal);
          continue;
        }
        throw e;
      } finally {
        call.dispose();
      }
    }

    if (response.promptFeedback?.blockReason) {
      throw new GeminiError(
        "safety",
        "Gemini a refusé la demande (filtre de sécurité). Reformulez l'idée ou les instructions.",
        { details: String(response.promptFeedback.blockReason) },
      );
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (finish === FinishReason.SAFETY || finish === FinishReason.PROHIBITED_CONTENT || finish === FinishReason.BLOCKLIST) {
      throw new GeminiError("safety", "La réponse a été bloquée par les filtres de sécurité de Gemini. Essayez un autre angle comique.");
    }
    const text = response.text ?? "";
    const raw = extractJson(text);
    const result: ValidationResult<T> =
      raw === undefined
        ? { ok: false, issues: [finish === FinishReason.MAX_TOKENS ? "The JSON was truncated (max tokens)." : "The response is not valid JSON."] }
        : req.validate(raw);
    if (result.ok) {
      cb.onPhase?.("finalizing");
      return result.data;
    }
    lastIssues = result.issues;
    contents.push({ role: "model", parts: [{ text }] });
    contents.push({ role: "user", parts: [{ text: buildRepairPrompt(result.issues) }] });
  }

  throw new GeminiError(
    "invalid_output",
    `Gemini a renvoyé ${req.subject ?? "une histoire"} incomplète, même après correction automatique. Réessayez (ou changez de modèle).`,
    { details: lastIssues.join("\n") },
  );
}

// ---------------------------------------------------------------------------
// Production complete
// ---------------------------------------------------------------------------

export interface StoryGenerationInput extends Omit<StoryRequest, "clipCount" | "supportingFruits" | "existingSupporting"> {
  model: string;
  /** Gemini invente des fruits au hasard qui interagissent avec le casting. */
  inventCharacters: boolean;
}

export interface GeneratedProduction {
  title: string;
  synopsis: string;
  story: StoryContent;
  clips: ClipInput[];
  params: ProductionParams;
}

/** Descripteur de secours construit depuis la fiche si Gemini en a oublie un. */
function fallbackDescriptor(c: CharacterDetail): CharacterDescriptor {
  const identity = activeCharacterIdentity(c);
  if (identity) return { name: c.name, visualDescriptor: identity.canonicalVisual, voiceDescriptor: identity.canonicalVoice };
  const visual = [c.species, c.appearance, c.distinctiveDetails].map((s) => s.trim()).filter(Boolean).join(". ");
  return { name: c.name, visualDescriptor: visual || c.species || c.name, voiceDescriptor: c.voice.trim() };
}

/** Descripteur fige de la version active : le meme d'une production a l'autre. */
function stableDescriptor(c: CharacterDetail, promptLanguage: string): CharacterDescriptor | null {
  const identity = activeCharacterIdentity(c);
  return identity?.promptLanguage === promptLanguage
    ? { name: c.name, visualDescriptor: identity.canonicalVisual, voiceDescriptor: identity.canonicalVoice }
    : null;
}

export function composeClipInputs(args: {
  clips: ClipContent[];
  clipDuration: number;
  story: StoryContent;
  promptLanguage: string;
  storyLanguage: string;
  characters: Pick<CharacterDetail, "name" | "images">[];
  /** Nombre total de clips de la production (par defaut : clips fournis). */
  clipCount?: number;
}): ClipInput[] {
  const withRefs = args.characters.filter((c) => c.images.length > 0).map((c) => c.name);
  return args.clips.map((clip) => ({
    clipNumber: clip.clipNumber,
    duration: args.clipDuration,
    content: clip,
    flowPrompt: composeFlowPrompt({
      clip,
      clipCount: args.clipCount ?? args.clips.length,
      clipDuration: args.clipDuration,
      visualStyle: args.story.visualStyle,
      descriptors: args.story.characterDescriptors,
      promptLanguage: args.promptLanguage,
      storyLanguage: args.storyLanguage,
      charactersWithReferences: withRefs,
    }),
  }));
}

export async function generateProduction(input: StoryGenerationInput, cb: GenerationCallbacks = {}): Promise<GeneratedProduction> {
  if (input.characters.length === 0) {
    throw new GeminiError("unknown", "Sélectionnez au moins un personnage.");
  }
  const clipCount = computeClipCount(input.targetDuration, input.clipDuration);
  // Le tirage se fait ici : sans lui, Gemini choisit presque toujours les memes fruits.
  const supportingFruits = input.inventCharacters
    ? pickSupportingFruits(1 + Math.floor(Math.random() * Math.min(3, clipCount)), input.characters.map((c) => c.species))
    : [];
  const request: StoryRequest = { ...input, clipCount, supportingFruits };
  const names = input.characters.map((c) => c.name);

  const { data: story, model } = await generateWithAvailableModel(
    {
      model: input.model,
      systemInstruction: buildSystemInstruction(request),
      prompt: buildStoryPrompt(request),
      jsonSchema: productionJsonSchema(clipCount, supportingFruits.length),
      validate: (raw) => validateStory(raw, { clipCount, clipDuration: input.clipDuration, characterNames: names, supportingCount: supportingFruits.length }),
    },
    cb,
  );

  const promptLanguage = resolvePromptLanguage(input.promptLanguage, input.language);
  const descriptors: CharacterDescriptor[] = [
    ...input.characters.map(
      (c) => stableDescriptor(c, promptLanguage) ?? story.characterDescriptors.find((d) => d.name === c.name) ?? fallbackDescriptor(c),
    ),
    ...story.supportingCharacters.map(({ name, visualDescriptor, voiceDescriptor }) => ({ name, visualDescriptor, voiceDescriptor })),
  ];
  const storyContent: StoryContent = {
    hook: story.hook,
    punchline: story.punchline,
    language: input.language,
    selectedCharacters: names,
    visualStyle: story.visualStyle,
    globalVisualDirection: story.globalVisualDirection,
    globalAudioDirection: story.globalAudioDirection,
    characterDescriptors: descriptors,
    supportingCharacters: story.supportingCharacters.map(({ name, fruit }) => ({ name, fruit })),
  };

  return {
    title: input.title?.trim() || story.title,
    synopsis: story.synopsis,
    story: storyContent,
    clips: composeClipInputs({
      clips: story.clips,
      clipDuration: input.clipDuration,
      story: storyContent,
      promptLanguage,
      storyLanguage: input.language,
      characters: input.characters,
    }),
    params: {
      storyIdea: input.storyIdea,
      comedyStyle: input.comedyStyle,
      language: input.language,
      promptLanguage: input.promptLanguage,
      musicMode: input.musicMode,
      additionalInstructions: input.additionalInstructions,
      inventCharacters: input.inventCharacters,
      continuityProductionId: null,
      model,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Developpement d'un personnage
// ---------------------------------------------------------------------------

export interface CharacterGenerationRequest extends CharacterBriefRequest {
  language: string;
  promptLanguage: PromptLanguage;
  model: string;
}

/** Ecrit la description de reference et compose le prompt unique du personnage. */
export async function generateCharacter(input: CharacterGenerationRequest, cb: GenerationCallbacks = {}): Promise<CharacterGenerationInput> {
  const { data: identity, model } = await generateWithAvailableModel(
    {
      model: input.model,
      systemInstruction: buildCharacterSystemInstruction(input),
      prompt: buildCharacterPrompt(input),
      jsonSchema: characterJsonSchema,
      validate: validateCharacterIdentity,
      subject: "une réponse",
      speed: "fast",
    },
    cb,
  );
  const promptLanguage = resolvePromptLanguage(input.promptLanguage, input.language);
  const prompt = composeCharacterModelSheetPrompt({ name: input.brief.name, canonicalVisual: identity.canonicalVisual, promptLanguage });
  return {
    instruction: input.instruction.trim(),
    model,
    brief: input.brief,
    identity: { ...identity, promptLanguage },
    prompts: [{ key: MODEL_SHEET_KEY, label: "Fiche modèle", prompt, original: prompt }],
  };
}

// ---------------------------------------------------------------------------
// Texte de publication
// ---------------------------------------------------------------------------

/** Ecrit la legende TikTok, le titre et la description YouTube d'une production. */
export async function generatePublishKit(input: { production: PublishSource; previous: PublishKit | null; model: string }, cb: GenerationCallbacks = {}): Promise<PublishKit> {
  const languageCode = input.production.params.language ?? input.production.story.language ?? "fr";
  const { data, model } = await generateWithAvailableModel(
    {
      model: input.model,
      systemInstruction: buildPublishSystemInstruction(languageCode),
      prompt: buildPublishPrompt(input.production, input.previous),
      jsonSchema: publishCopyJsonSchema,
      validate: validatePublishCopy,
      subject: "une réponse",
      speed: "fast",
    },
    cb,
  );
  return finalizePublishKit(data, model);
}

// ---------------------------------------------------------------------------
// Regeneration d'un clip
// ---------------------------------------------------------------------------

export interface ClipRegenerationInput {
  production: ProductionDetail;
  characters: CharacterDetail[];
  clipNumber: number;
  instruction: string;
  model: string;
}

export async function regenerateClip(input: ClipRegenerationInput, cb: GenerationCallbacks = {}): Promise<ClipInput> {
  const p = input.production;
  const params = p.params;
  const story = p.story as StoryContent;
  const clips = p.clips.map((c) => parseClipContent(c.content)).filter((c): c is ClipContent => c !== null);
  if (clips.length !== p.clips.length) {
    throw new GeminiError("invalid_output", "Le contenu de certains clips est illisible : régénérez plutôt l'histoire complète.");
  }
  const languageCode = params.language ?? story.language ?? "fr";
  const supportingNames = (story.supportingCharacters ?? []).map((s) => s.name);
  const existingSupporting = (story.characterDescriptors ?? []).filter((d) => supportingNames.includes(d.name));
  const base: StoryRequest = {
    title: p.title,
    characters: input.characters,
    storyIdea: params.storyIdea ?? "",
    comedyStyle: params.comedyStyle ?? "mixed",
    targetDuration: p.targetDuration,
    clipDuration: p.clipDuration,
    clipCount: p.clips.length,
    language: languageCode,
    promptLanguage: params.promptLanguage ?? "en",
    musicMode: params.musicMode ?? "flow",
    additionalInstructions: params.additionalInstructions ?? "",
    continuity: null,
    existingSupporting,
  };
  const names = [...input.characters.map((c) => c.name), ...supportingNames];
  const { data: clip } = await generateWithAvailableModel(
    {
      model: input.model,
      systemInstruction: buildSystemInstruction(base),
      prompt: buildClipPrompt({
        ...base,
        clipNumber: input.clipNumber,
        clips,
        instruction: input.instruction,
        storySummary: {
          title: p.title,
          synopsis: p.synopsis,
          hook: story.hook ?? "",
          punchline: story.punchline ?? "",
          globalVisualDirection: story.globalVisualDirection ?? "",
          globalAudioDirection: story.globalAudioDirection ?? "",
        },
      }),
      jsonSchema: clipJsonSchema,
      validate: (raw) =>
        validateClip(raw, { clipNumber: input.clipNumber, clipCount: p.clips.length, clipDuration: p.clipDuration, characterNames: names }),
    },
    cb,
  );
  const [composed] = composeClipInputs({
    clips: [clip],
    clipDuration: p.clipDuration,
    story: {
      hook: story.hook ?? "",
      punchline: story.punchline ?? "",
      language: languageCode,
      selectedCharacters: names,
      visualStyle: story.visualStyle ?? "",
      globalVisualDirection: story.globalVisualDirection ?? "",
      globalAudioDirection: story.globalAudioDirection ?? "",
      characterDescriptors: story.characterDescriptors?.length
        ? story.characterDescriptors
        : input.characters.map(fallbackDescriptor),
    },
    promptLanguage: resolvePromptLanguage(base.promptLanguage, languageCode),
    storyLanguage: languageCode,
    characters: input.characters,
    clipCount: p.clips.length,
  });
  return composed;
}

/** Contexte de suite a partir d'une production existante. */
export function continuityFrom(production: ProductionDetail): ContinuityContext {
  const last = [...production.clips].sort((a, b) => b.clipNumber - a.clipNumber)[0];
  const lastContent = last ? parseClipContent(last.content) : null;
  return {
    title: production.title,
    synopsis: production.synopsis,
    punchline: (production.story as Partial<StoryContent>).punchline ?? "",
    lastClipSummary: lastContent ? `${lastContent.sceneDescription} ${lastContent.continuityInstructions}` : "",
  };
}
