/**
 * Schemas de la reponse Gemini.
 * - `*JsonSchema` : envoye a Gemini (`responseJsonSchema`) pour contraindre la sortie.
 * - Schemas Zod : validation stricte a l'execution avant toute ecriture en base.
 */
import { z } from "zod";
import type { CharacterGeneration } from "@/types";

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const text = z.string().trim();

export const DialogueLineSchema = z.object({
  character: text.min(1),
  line: text.min(1),
  delivery: text.default(""),
});

export const CharacterBeatSchema = z.object({
  character: text.min(1),
  description: text.min(1),
});

export const ClipSchema = z.object({
  clipNumber: z.number().int().positive(),
  duration: z.number().positive(),
  sceneDescription: text.min(1),
  location: text.min(1),
  charactersPresent: z.array(text.min(1)).min(1),
  characterActions: z.array(CharacterBeatSchema).default([]),
  facialExpressions: z.array(CharacterBeatSchema).default([]),
  cameraDirections: text.min(1),
  dialogue: z.array(DialogueLineSchema).default([]),
  soundEffects: z.array(text.min(1)).default([]),
  musicInstructions: text.min(1),
  continuityInstructions: text.min(1),
  googleFlowPrompt: text.min(40, "googleFlowPrompt est trop court"),
});

export const CharacterDescriptorSchema = z.object({
  name: text.min(1),
  visualDescriptor: text.min(10),
  voiceDescriptor: text.default(""),
});

export const SupportingCharacterSchema = CharacterDescriptorSchema.extend({
  fruit: text.min(1),
});

export const ProductionStorySchema = z.object({
  title: text.min(1).max(120),
  synopsis: text.min(1),
  hook: text.min(1),
  punchline: text.min(1),
  targetDuration: z.number().positive(),
  clipDuration: z.number().positive(),
  language: text.min(1),
  selectedCharacters: z.array(text.min(1)).min(1),
  visualStyle: text.min(1),
  globalVisualDirection: text.min(1),
  globalAudioDirection: text.min(1),
  characterDescriptors: z.array(CharacterDescriptorSchema).min(1),
  supportingCharacters: z.array(SupportingCharacterSchema).default([]),
  clips: z.array(ClipSchema).min(1),
});

export type DialogueLine = z.infer<typeof DialogueLineSchema>;
export type CharacterBeat = z.infer<typeof CharacterBeatSchema>;
export type ClipContent = z.infer<typeof ClipSchema>;
export type CharacterDescriptor = z.infer<typeof CharacterDescriptorSchema>;
export type SupportingCharacter = z.infer<typeof SupportingCharacterSchema>;
export type GeneratedStory = z.infer<typeof ProductionStorySchema>;

/** Partie "histoire" stockee avec la production (hors clips). */
export interface StoryContent {
  hook: string;
  punchline: string;
  language: string;
  selectedCharacters: string[];
  visualStyle: string;
  globalVisualDirection: string;
  globalAudioDirection: string;
  /** Casting choisi + fruits inventes : chacun est decrit dans les prompts ou il apparait. */
  characterDescriptors: CharacterDescriptor[];
  /** Texte de publication pret a copier. */
  publishKit?: PublishKit;
  /** Fruits inventes par Gemini (absent des histoires plus anciennes). */
  supportingCharacters?: Pick<SupportingCharacter, "name" | "fruit">[];
}

// --- Identite d'un personnage ------------------------------------------------

export const CharacterIdentitySchema = z.object({
  canonicalVisual: text.min(20, "canonicalVisual est trop court"),
  canonicalVoice: text.default(""),
});

/** Identite stockee : la langue des descripteurs est memorisee avec eux. */
export const StoredCharacterIdentitySchema = CharacterIdentitySchema.extend({
  promptLanguage: text.default("en"),
});

export type CharacterIdentity = z.infer<typeof CharacterIdentitySchema>;
export type StoredCharacterIdentity = z.infer<typeof StoredCharacterIdentitySchema>;

/** Cle du prompt unique d'un personnage. */
export const MODEL_SHEET_KEY = "model_sheet";

/** Un prompt pret a copier. `original` permet de revenir au texte genere. */
export interface CharacterImagePrompt {
  key: string;
  label: string;
  prompt: string;
  original: string;
}

/** Identite lisible d'une version (tolerant : renvoie null si invalide). */
export function parseCharacterIdentity(value: unknown): StoredCharacterIdentity | null {
  const result = StoredCharacterIdentitySchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Identite de la version utilisee par l'application, si le personnage en a une. */
export function activeCharacterIdentity(character: { activeGenerationId: string | null; generations: CharacterGeneration[] }): StoredCharacterIdentity | null {
  const version = character.generations.find((g) => g.id === character.activeGenerationId);
  return version ? parseCharacterIdentity(version.identity) : null;
}

// --- Texte de publication ------------------------------------------------------

export const PublishCopySchema = z.object({
  tiktokCaption: text.min(10),
  tiktokHashtags: z.array(text.min(2)).min(3),
  youtubeTitle: text.min(5),
  youtubeDescription: text.min(10),
  youtubeHashtags: z.array(text.min(2)).min(1),
});

export type PublishCopy = z.infer<typeof PublishCopySchema>;

/** Texte final, tel qu'il est copie sur TikTok et YouTube. */
export interface PublishKit {
  tiktok: string;
  youtubeTitle: string;
  youtubeDescription: string;
  model: string;
}

/** Valide un contenu de clip stocke (tolerant : renvoie null si invalide). */
export function parseClipContent(value: unknown): ClipContent | null {
  const result = ClipSchema.safeParse(value);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// JSON Schema envoye a Gemini (sous-ensemble supporte : type, properties,
// required, items, description, minItems, maxItems).
// ---------------------------------------------------------------------------

const str = (description: string) => ({ type: "string", description });

const beatArray = (description: string) => ({
  type: "array",
  description,
  items: {
    type: "object",
    properties: {
      character: str("Character name, exactly as in the character list."),
      description: str("What this character does / shows."),
    },
    required: ["character", "description"],
  },
});

export const clipJsonSchema = {
  type: "object",
  properties: {
    clipNumber: { type: "integer", description: "1-based position of the clip in the story." },
    duration: { type: "number", description: "Clip duration in seconds." },
    sceneDescription: str("What happens in this clip, as a short readable paragraph (story language)."),
    location: str("Location / set of this clip (story language)."),
    charactersPresent: {
      type: "array",
      description: "Names of the characters visible in this clip, exactly as in the character list.",
      items: { type: "string" },
      minItems: 1,
    },
    characterActions: beatArray("Physical actions per character with approximate timestamps (story language)."),
    facialExpressions: beatArray("Facial expressions and exaggerated reactions per character (story language)."),
    cameraDirections: str("Vertical 9:16 framing, shots and camera movement (story language)."),
    dialogue: {
      type: "array",
      description: "Spoken lines in order. Keep them short enough for the clip duration.",
      items: {
        type: "object",
        properties: {
          character: str("Speaking character name."),
          line: str("Exact spoken line in the story language."),
          delivery: str("Tone / emotion / timing of the delivery (story language)."),
        },
        required: ["character", "line", "delivery"],
      },
    },
    soundEffects: { type: "array", description: "Sound effects with timing (story language).", items: { type: "string" } },
    musicInstructions: str("Background music instructions for this clip, ensuring continuity (story language)."),
    continuityInstructions: str(
      "Start state (matching previous clip end) and end state (handoff to next clip): positions, props, lighting (story language).",
    ),
    googleFlowPrompt: str(
      "Ready-to-paste Google Flow / Veo scene prompt in the prompt language, WITHOUT character appearance descriptions and WITHOUT a format header (both are added automatically).",
    ),
  },
  required: [
    "clipNumber",
    "duration",
    "sceneDescription",
    "location",
    "charactersPresent",
    "characterActions",
    "facialExpressions",
    "cameraDirections",
    "dialogue",
    "soundEffects",
    "musicInstructions",
    "continuityInstructions",
    "googleFlowPrompt",
  ],
} as const;

export function productionJsonSchema(clipCount: number, supportingCount = 0) {
  const supporting =
    supportingCount > 0
      ? {
          supportingCharacters: {
            type: "array",
            description: "The invented supporting fruit characters, one per drawn fruit.",
            minItems: supportingCount,
            maxItems: supportingCount,
            items: {
              type: "object",
              properties: {
                name: str("Short funny name, different from the selected characters."),
                fruit: str("The fruit, in the story language."),
                visualDescriptor: str("20-35 words canonical visual descriptor (prompt language): simple design, no clothing or accessories."),
                voiceDescriptor: str("8-20 words voice descriptor (prompt language)."),
              },
              required: ["name", "fruit", "visualDescriptor", "voiceDescriptor"],
            },
          },
        }
      : {};
  return {
    type: "object",
    properties: {
      title: str("Catchy production title (story language, max 60 characters)."),
      synopsis: str("2-3 sentence synopsis of the whole story (story language)."),
      hook: str("The opening hook of clip 1 (story language)."),
      punchline: str("The final punchline / twist of the last clip (story language)."),
      targetDuration: { type: "number" },
      clipDuration: { type: "number" },
      language: str("Story language code, e.g. fr."),
      selectedCharacters: { type: "array", items: { type: "string" }, minItems: 1 },
      visualStyle: str("One sentence describing the global animation style, in the prompt language."),
      globalVisualDirection: str("Global visual direction: style, palette, lighting, set (story language)."),
      globalAudioDirection: str("Global audio direction: music theme, tempo, mix, voices (story language)."),
      characterDescriptors: {
        type: "array",
        description: "One canonical descriptor per selected character, in the prompt language.",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name: str("Character name, exactly as given."),
            visualDescriptor: str("25-45 words canonical visual descriptor (prompt language)."),
            voiceDescriptor: str("8-20 words voice descriptor (prompt language)."),
          },
          required: ["name", "visualDescriptor", "voiceDescriptor"],
        },
      },
      ...supporting,
      clips: { type: "array", items: clipJsonSchema, minItems: clipCount, maxItems: clipCount },
    },
    required: [
      "title",
      "synopsis",
      "hook",
      "punchline",
      "targetDuration",
      "clipDuration",
      "language",
      "selectedCharacters",
      "visualStyle",
      "globalVisualDirection",
      "globalAudioDirection",
      "characterDescriptors",
      ...(supportingCount > 0 ? ["supportingCharacters"] : []),
      "clips",
    ],
  };
}

export const publishCopyJsonSchema = {
  type: "object",
  properties: {
    tiktokCaption: str("1-2 short sentences, 120 characters maximum, no hashtags."),
    tiktokHashtags: { type: "array", description: "Exactly 4 hashtags, without the # sign.", items: { type: "string" }, minItems: 4, maxItems: 4 },
    youtubeTitle: str("60 characters maximum, no hashtags."),
    youtubeDescription: str("1-2 sentences with natural keywords, no hashtags."),
    youtubeHashtags: { type: "array", description: "Exactly 3 hashtags, without the # sign.", items: { type: "string" }, minItems: 3, maxItems: 3 },
  },
  required: ["tiktokCaption", "tiktokHashtags", "youtubeTitle", "youtubeDescription", "youtubeHashtags"],
} as const;

export const characterJsonSchema = {
  type: "object",
  properties: {
    canonicalVisual: str("25-45 words, prompt language: the fruit, its colors and shape, a simple face and limbs, and only what the user described. No name, pose, emotion, background or art style."),
    canonicalVoice: str("8-15 words voice descriptor (prompt language)."),
  },
  required: ["canonicalVisual", "canonicalVoice"],
} as const;

// ---------------------------------------------------------------------------
// Validation metier (au-dela de la forme)
// ---------------------------------------------------------------------------

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; issues: string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`);
}

export function validatePublishCopy(raw: unknown): ValidationResult<PublishCopy> {
  const parsed = PublishCopySchema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: zodIssues(parsed.error) };
}

export function validateCharacterIdentity(raw: unknown): ValidationResult<CharacterIdentity> {
  const parsed = CharacterIdentitySchema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: zodIssues(parsed.error) };
}

export interface StoryExpectations {
  clipCount: number;
  clipDuration: number;
  characterNames: string[];
  /** Nombre de fruits inventes attendus (0 ou absent : casting seul). */
  supportingCount?: number;
}

/** Rattache un nom renvoye par Gemini au nom exact du personnage (casse, accents, espaces). */
export function matchCharacterName(name: string, known: string[]): string | null {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(name);
  return known.find((k) => norm(k) === target) ?? known.find((k) => target.includes(norm(k))) ?? null;
}

export function validateClip(raw: unknown, expectations: StoryExpectations & { clipNumber: number }): ValidationResult<ClipContent> {
  const parsed = ClipSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  return { ok: true, data: normalizeClip(parsed.data, expectations.clipNumber, expectations) };
}

function normalizeClip(clip: ClipContent, clipNumber: number, exp: StoryExpectations): ClipContent {
  const present = clip.charactersPresent
    .map((n) => matchCharacterName(n, exp.characterNames))
    .filter((n): n is string => n !== null);
  const fixName = (n: string) => matchCharacterName(n, exp.characterNames) ?? n;
  return {
    ...clip,
    clipNumber,
    duration: exp.clipDuration,
    charactersPresent: present.length ? Array.from(new Set(present)) : clip.charactersPresent,
    dialogue: clip.dialogue.map((d) => ({ ...d, character: fixName(d.character) })),
    characterActions: clip.characterActions.map((b) => ({ ...b, character: fixName(b.character) })),
    facialExpressions: clip.facialExpressions.map((b) => ({ ...b, character: fixName(b.character) })),
  };
}

export function validateStory(raw: unknown, exp: StoryExpectations): ValidationResult<GeneratedStory> {
  const parsed = ProductionStorySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const story = parsed.data;
  const issues: string[] = [];

  if (story.clips.length !== exp.clipCount) {
    issues.push(`clips: expected exactly ${exp.clipCount} clips, got ${story.clips.length}.`);
  }
  const sorted = [...story.clips].sort((a, b) => a.clipNumber - b.clipNumber);
  const numbers = sorted.map((c) => c.clipNumber);
  const sequential = numbers.every((n, i) => n === i + 1);
  if (!sequential) {
    issues.push(`clips: clipNumber values must be 1..${exp.clipCount} in order (got ${numbers.join(", ")}).`);
  }
  for (const clip of story.clips) {
    const known = clip.charactersPresent.filter((n) => matchCharacterName(n, exp.characterNames));
    if (known.length === 0) {
      issues.push(`clip ${clip.clipNumber}: charactersPresent must contain at least one of ${exp.characterNames.join(", ")}.`);
    }
  }
  const supportingNames = story.supportingCharacters.map((c) => c.name);
  if (exp.supportingCount) {
    if (supportingNames.length === 0) {
      issues.push("supportingCharacters: invent the requested supporting characters.");
    } else if (!story.clips.some((clip) => clip.charactersPresent.some((n) => matchCharacterName(n, supportingNames)))) {
      issues.push("clips: the supporting characters must appear in charactersPresent.");
    }
    for (const name of supportingNames) {
      if (matchCharacterName(name, exp.characterNames)) {
        issues.push(`supportingCharacters: "${name}" must be a new name, different from the selected characters.`);
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  const allNames = [...exp.characterNames, ...supportingNames];

  return {
    ok: true,
    data: {
      ...story,
      clipDuration: exp.clipDuration,
      targetDuration: exp.clipCount * exp.clipDuration,
      clips: sorted.map((clip, i) => normalizeClip(clip, i + 1, { ...exp, characterNames: allNames })),
      characterDescriptors: story.characterDescriptors.map((d) => ({
        ...d,
        name: matchCharacterName(d.name, exp.characterNames) ?? d.name,
      })),
    },
  };
}
