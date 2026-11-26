/**
 * Construction des consignes envoyees a Gemini. Les consignes sont redigees en
 * anglais (plus precises pour le modele) ; la langue de sortie est imposee
 * explicitement pour chaque champ.
 */
import type { CharacterDetail, CharacterEssentials, CharacterOlderNotes, ComedyStyle, MusicMode, ProductionSummary, PromptLanguage } from "@/types";
import { angle, comedyStyle, language } from "@/utils/catalog";
import { activeCharacterIdentity, type CharacterDescriptor, type CharacterIdentity, type ClipContent, type PublishKit } from "./schemas";

export interface ContinuityContext {
  title: string;
  synopsis: string;
  punchline: string;
  lastClipSummary: string;
}

export interface StoryRequest {
  title?: string;
  characters: CharacterDetail[];
  storyIdea: string;
  comedyStyle: ComedyStyle;
  targetDuration: number;
  clipDuration: number;
  clipCount: number;
  language: string;
  promptLanguage: PromptLanguage;
  musicMode: MusicMode;
  additionalInstructions: string;
  continuity: ContinuityContext | null;
  /** Fruits tires au sort pour lesquels Gemini invente un personnage. */
  supportingFruits?: string[];
  /** Fruits deja inventes pour cette histoire (regeneration d'un clip). */
  existingSupporting?: CharacterDescriptor[];
}

/** Langue effective des prompts Flow (anglais recommande pour Veo). */
export function resolvePromptLanguage(promptLanguage: PromptLanguage, storyLanguage: string): string {
  return promptLanguage === "en" ? "en" : storyLanguage;
}

function field(label: string, value: string | undefined): string | null {
  const v = value?.trim();
  return v ? `- ${label}: ${v}` : null;
}

/** Fiche d'un personnage telle que transmise a Gemini. */
export function characterSheet(character: CharacterDetail, selectedIds: Set<string>): string {
  const angles = Array.from(new Set(character.images.map((img) => angle(img.label).english)));
  const relations = character.relationships
    .filter((r) => selectedIds.has(r.relatedCharacterId))
    .map((r) =>
      r.direction === "outgoing"
        ? `${character.name} → ${r.relatedName}: ${r.relation}${r.description ? ` (${r.description})` : ""}`
        : `${r.relatedName} → ${character.name}: ${r.relation}${r.description ? ` (${r.description})` : ""}`,
    );
  const identity = activeCharacterIdentity(character);
  const lines = [
    `### CHARACTER: ${character.name}`,
    field("Fruit / species", character.species),
    field("Short description", character.shortDescription),
    field("Personality", character.personality),
    field("Typical behavior", character.behavior),
    field("Voice", character.voice),
    field("Expressions & mannerisms", character.mannerisms),
    field("Physical appearance", character.appearance),
    field("Distinctive visual details", character.distinctiveDetails),
    field("Canonical visual descriptor", identity?.canonicalVisual),
    field("Voice descriptor", identity?.canonicalVoice),
    field("Additional creative instructions", character.creativeNotes),
    angles.length
      ? `- Reference images exist in the user's library (${angles.join(", ")}). They are NOT attached to this request; the user uploads them separately in Google Flow.`
      : "- No reference images: rely on the written description only.",
    relations.length ? `- Relationships with other selected characters:\n  ${relations.join("\n  ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function musicRules(mode: MusicMode): string {
  return mode === "post"
    ? `MUSIC STRATEGY: background music will be added later during editing as ONE continuous track.
- In every googleFlowPrompt explicitly request: "No background music" (keep only dialogue, sound effects and ambience).
- musicInstructions describe the editing music cue for this clip (mood, energy) so the final track fits.`
    : `MUSIC STRATEGY: the same background music must feel continuous across all clips.
- Define ONE theme in globalAudioDirection (genre, instruments, tempo in BPM, mood) and reuse the exact same wording in every clip.
- In every googleFlowPrompt request that the background music "continues seamlessly at the same tempo and volume, without restarting, fading out or changing" (clip 1 starts it; the last clip may end on a short musical sting under the punchline).`;
}

/** Regles d'interaction comique et de creation des fruits inventes. */
function supportingRules(fruits: string[], existing: CharacterDescriptor[], promptLang: string): string {
  if (fruits.length === 0 && existing.length === 0) return "";
  const interaction = `INTERACTION COMEDY
- A cartoon rivalry in the spirit of classic cat-and-mouse shorts: a clear comic conflict between characters, pranks, traps, chases, plans that backfire on their author, exaggerated but harmless impacts, instant comebacks. Blend it with the requested comedy style.
- Every clip shows at least two characters interacting on screen, physically and in dialogue. Nobody talks to the camera or addresses the viewer: characters only talk to each other.
- At most 3 characters on screen at the same time, so the action stays readable.`;
  if (existing.length > 0) {
    return `${interaction}

SUPPORTING CHARACTERS ALREADY IN THIS STORY (use their exact names, do not invent others)
${existing.map((d) => `- ${d.name}: ${d.visualDescriptor}`).join("\n")}\n\n`;
  }
  return `${interaction}

SUPPORTING CHARACTERS (field supportingCharacters)
- Invent exactly ${fruits.length} new supporting fruit character(s), one for each of these randomly drawn fruits: ${fruits.join(", ")}. Give each one a short funny name, different from the selected characters, and one strong comic trait that clashes with them.
- They arrive gradually: the first appears in clip 1, the others join in later clips, so the cast and the chaos grow. Once on screen, a character keeps the same name, look, voice and behavior.
- Treat them as full characters: list them in charactersPresent and write their actions, expressions and dialogue with their exact names.
- visualDescriptor: 20–35 words in ${promptLang}, a simple design: the fruit itself as the body, a simple expressive face, simple limbs, no clothing or accessories. Same 3D cartoon universe as the selected characters.
- voiceDescriptor: 8–20 words in ${promptLang}.
- fruit: the name of the fruit in the story language.\n\n`;
}

export function buildSystemInstruction(req: Pick<StoryRequest, "clipDuration" | "language" | "promptLanguage" | "musicMode" | "supportingFruits" | "existingSupporting">): string {
  const storyLang = language(req.language).englishName;
  const promptLang = language(resolvePromptLanguage(req.promptLanguage, req.language)).englishName;
  const maxWords = Math.max(8, Math.round(req.clipDuration * 2.4));
  const fruits = req.supportingFruits ?? [];
  const existing = req.existingSupporting ?? [];
  const castRule =
    fruits.length > 0 || existing.length > 0
      ? "The selected characters stay the stars, but they are never alone: the comedy comes from their on-screen interactions with the supporting characters defined below."
      : "Only the provided characters are main characters; unnamed background extras are allowed only if essential and stay silent.";
  return `You are the head writer and AI video director of "Fruity Studio", a channel of viral vertical (9:16) cartoon shorts starring anthropomorphic fruit characters. You write ONE short, original, genuinely funny story and split it into consecutive clips. Each clip is generated separately by Google Veo inside Google Flow, then the clips are edited together into one TikTok video.

STORY RULES
1. One coherent story with a beginning, an escalation and a payoff — never a series of unrelated sketches. Clip N+1 starts exactly where clip N ends (same moment, positions, props and lighting).
2. Open with a scroll-stopping hook in the first 2 seconds of clip 1 (a visual surprise or a provocative first line).
3. Every clip contains at least one laugh: physical comedy, exaggerated reactions, absurd escalation or a sharp line.
4. The last clip ends with a strong punchline or twist landing in its final 2–3 seconds.
5. Contemporary TikTok humor: fast rhythm, relatable situations, quotable lines. No real brands, real people, copyrighted characters or song titles.
6. Respect each character's personality, voice, behavior, mannerisms and relationships exactly as described. ${castRule}
7. Family-friendly cartoon comedy: no gore, no sexual content, no hate, no realistic violence. "Dark comedy" means light, non-graphic irony about fruit life.
8. Unless a sequel is explicitly requested, the story is standalone and must not reference other episodes.

TIMING RULES (each clip lasts exactly ${req.clipDuration} seconds)
- At most ${maxWords} spoken words in total per clip, in 1–4 short lines, leaving room for reactions.
- 2–4 action beats per clip with approximate timestamps (e.g. 0–3s, 3–7s, 7–${req.clipDuration}s); every action must fit in the clip.

CONTINUITY RULES
- Keep one main location (or a clearly motivated move) with consistent lighting, time of day, props and set dressing.
- Track screen positions (left / center / right), accessories and props; state the start and end state of each clip in continuityInstructions.
${musicRules(req.musicMode)}

GOOGLE FLOW PROMPT RULES (field googleFlowPrompt)
- Written in ${promptLang}. Dialogue lines stay verbatim in ${storyLang}, inside double quotes, introduced by the speaker's name and delivery, with an explicit request for accurate lip-sync.
- A self-contained shot description for Veo: setting, starting positions (matching the end of the previous clip), action beats with timestamps, facial expressions, camera framing and movement for a vertical 9:16 frame, lighting, dialogue with lip-sync, sound effects, music instruction, and the exact final moment (handoff to the next clip).
- Refer to characters by name only. Do NOT describe their physical appearance and do NOT add a format header: the app automatically prepends the format, the visual style and each character's canonical descriptor.
- Never mention URLs, file names or attachments, and never claim that images are attached.
- 120–220 words of plain prose, no markdown, no bullet characters.

CHARACTER DESCRIPTORS (field characterDescriptors)
- One entry per selected character, name exactly as given.
- visualDescriptor: 25–45 words in ${promptLang}, derived strictly from the character sheet (fruit type, body shape, colors, texture, face, eyes, limbs, clothing, accessories, distinctive details). Precise and stable so Veo renders the same character in every clip.
- voiceDescriptor: 8–20 words in ${promptLang} (timbre, apparent age, accent, energy).

${supportingRules(fruits, existing, promptLang)}LANGUAGES
- visualStyle, characterDescriptors and googleFlowPrompt: ${promptLang}.
- Everything else (title, synopsis, hook, punchline, directions, scene descriptions, locations, actions, expressions, camera directions, dialogue, sound effects, music and continuity instructions): ${storyLang}.

OUTPUT: return ONLY the JSON object defined by the response schema.`;
}

export function buildStoryPrompt(req: StoryRequest): string {
  const selectedIds = new Set(req.characters.map((c) => c.id));
  const style = comedyStyle(req.comedyStyle);
  const storyLang = language(req.language);
  const promptLang = language(resolvePromptLanguage(req.promptLanguage, req.language));
  const idea = req.storyIdea.trim();
  const continuity = req.continuity
    ? `SEQUEL REQUESTED — continue from this previous production:
- Previous title: ${req.continuity.title}
- Previous synopsis: ${req.continuity.synopsis}
- Previous ending: ${req.continuity.punchline}
- Last clip of the previous production: ${req.continuity.lastClipSummary}
Write a new self-contained episode that follows from it (a viewer who missed it must still understand).`
    : "STANDALONE STORY: this production is independent. Do not reference any previous story.";

  return `Write ONE new production.

PRODUCTION SETTINGS
- Total duration: ${req.clipCount * req.clipDuration} seconds (target ${req.targetDuration} s)
- Number of clips: EXACTLY ${req.clipCount} (clipNumber 1 to ${req.clipCount}), each exactly ${req.clipDuration} seconds (duration = ${req.clipDuration})
- Story and dialogue language: ${storyLang.englishName} (${storyLang.code})
- Google Flow prompt language: ${promptLang.englishName}
- Comedy style: ${style.prompt}
${req.title?.trim() ? `- Working title chosen by the user: "${req.title.trim()}" (keep it as the title)` : "- Title: invent a catchy one"}
- Story idea from the user: ${idea ? `"${idea}"` : "none — invent an original, surprising premise that fits these characters."}
${req.additionalInstructions.trim() ? `- Additional instructions from the user: ${req.additionalInstructions.trim()}` : ""}

${continuity}

SELECTED CHARACTERS (use their names exactly as written: ${req.characters.map((c) => `"${c.name}"`).join(", ")})

${req.characters.map((c) => characterSheet(c, selectedIds)).join("\n\n")}`;
}

/** Resume compact d'un clip pour le contexte de regeneration. */
export function summarizeClip(clip: ClipContent): string {
  const dialogue = clip.dialogue.map((d) => `${d.character}: "${d.line}"`).join(" / ");
  return `Clip ${clip.clipNumber} — ${clip.sceneDescription}${dialogue ? ` Dialogue: ${dialogue}` : ""} Continuity: ${clip.continuityInstructions}`;
}

export interface ClipRegenerationRequest extends StoryRequest {
  clipNumber: number;
  storySummary: { title: string; synopsis: string; hook: string; punchline: string; globalVisualDirection: string; globalAudioDirection: string };
  clips: ClipContent[];
  instruction: string;
}

export function buildClipPrompt(req: ClipRegenerationRequest): string {
  const selectedIds = new Set(req.characters.map((c) => c.id));
  const current = req.clips.find((c) => c.clipNumber === req.clipNumber);
  const previous = req.clips.find((c) => c.clipNumber === req.clipNumber - 1);
  const next = req.clips.find((c) => c.clipNumber === req.clipNumber + 1);
  return `Rewrite ONLY clip ${req.clipNumber} of ${req.clipCount} of an existing production. Return a single clip object (clipNumber = ${req.clipNumber}, duration = ${req.clipDuration}).

EXISTING PRODUCTION
- Title: ${req.storySummary.title}
- Synopsis: ${req.storySummary.synopsis}
- Hook: ${req.storySummary.hook}
- Punchline: ${req.storySummary.punchline}
- Global visual direction: ${req.storySummary.globalVisualDirection}
- Global audio direction: ${req.storySummary.globalAudioDirection}
- Comedy style: ${comedyStyle(req.comedyStyle).prompt}

ALL CLIPS (for continuity)
${req.clips.map(summarizeClip).join("\n")}

CONSTRAINTS FOR THE NEW CLIP ${req.clipNumber}
- ${previous ? `It must start exactly where clip ${previous.clipNumber} ends: ${previous.continuityInstructions}` : "It is the opening clip: it must start with a strong hook."}
- ${next ? `It must end in a state that leads naturally into clip ${next.clipNumber}: ${next.sceneDescription}` : "It is the final clip: it must land the punchline."}
- Keep the same location, lighting, music and character positions unless the story requires a change.
${req.instruction.trim() ? `- User request for this new version: ${req.instruction.trim()}` : "- Make it funnier and tighter than the current version."}

CURRENT VERSION OF CLIP ${req.clipNumber}
${current ? JSON.stringify(current) : "(missing)"}

CHARACTERS
${req.characters.map((c) => characterSheet(c, selectedIds)).join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Developpement d'un personnage
// ---------------------------------------------------------------------------

export function buildCharacterSystemInstruction(req: { language: string; promptLanguage: PromptLanguage }): string {
  const promptLang = language(resolvePromptLanguage(req.promptLanguage, req.language)).englishName;
  return `You write the visual description of ONE simple cartoon fruit character for "Fruity Studio". It is pasted into an image generator.

RULES
1. The character is a living fruit: the fruit IS the body, with a simple friendly face and simple limbs.
2. Keep it simple and clean: only the fruit and what the user explicitly described.
3. Do NOT invent clothing, accessories, props, patterns or extra details. If the user mentions some, include exactly those.
4. Original design only: no real brands, real people, copyrighted characters or logos. Family-friendly.

FIELDS
- canonicalVisual: 25–45 words in ${promptLang}, starting with the fruit: colors, shape, face, limbs and anything the user described. No name, pose, emotion, background or art style.
- canonicalVoice: 8–15 words in ${promptLang}, built from the voice tone given.

OUTPUT: return ONLY the JSON object defined by the response schema.`;
}

export interface CharacterBriefRequest {
  brief: CharacterEssentials;
  olderNotes: Partial<CharacterOlderNotes>;
  instruction: string;
  /** Version a faire evoluer quand l'utilisateur demande un changement precis. */
  previous: CharacterIdentity | null;
}

export function buildCharacterPrompt(req: CharacterBriefRequest): string {
  const notes = [field("Physical appearance", req.olderNotes.appearance), field("Distinctive visual details", req.olderNotes.distinctiveDetails)].filter(Boolean);
  const instruction = req.instruction.trim();

  return [
    `Describe this character.

BRIEF FROM THE USER
${[
  field("Name", req.brief.name),
  field("Fruit", req.brief.species),
  field("What the user imagines", req.brief.shortDescription) ?? "- What the user imagines: nothing specified, keep the plain fruit with a simple face.",
  field("Voice tone", req.brief.voice) ?? "- Voice tone: nothing specified, choose one that fits.",
].join("\n")}`,
    notes.length ? `EARLIER NOTES ON THIS CHARACTER (stay consistent with them)\n${notes.join("\n")}` : null,
    req.previous && instruction
      ? `CURRENT VERSION\n${JSON.stringify(req.previous)}\n\nCHANGE REQUESTED BY THE USER: ${instruction}\nApply this change and keep everything else as it is.`
      : instruction
        ? `ADDITIONAL REQUEST FROM THE USER: ${instruction}`
        : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Texte de publication
// ---------------------------------------------------------------------------

export function buildPublishSystemInstruction(languageCode: string): string {
  return `You are a growth strategist for short vertical videos on TikTok and YouTube Shorts. You write the publishing copy that gives ONE finished comedy short the widest possible reach.

WHAT DRIVES REACH
Both platforms show a video to more people when viewers stop scrolling, watch to the end, rewatch, comment and share, and they read the words of the caption or title to decide who to show it to. So the copy must:
1. Open a curiosity gap in the very first words, and never reveal the punchline.
2. Use the natural words a viewer would search for (the fruits, the situation, funny cartoon, animation) early and naturally, never as a list of keywords.
3. Give a reason to comment: end the TikTok caption with a short question that is easy and fun to answer, tied to the story (taking sides, guessing what happens).
4. Sound like a person, not a brand: short, punchy, playful.
5. Stay truthful to the video. No fake promises, no requests for likes, follows or shares, no real brands, real people or copyrighted characters. Family-friendly.

Before answering, silently draft several options for each field and keep only the strongest one.

TIKTOK
- tiktokCaption: 1–2 short sentences, 120 characters maximum, no hashtags.
- tiktokHashtags: exactly 4, without the # sign: one broad topic the video belongs to, two specific to this video's content, one for its community or format. Never generic reach tags such as fyp, foryou, viral or pourtoi.

YOUTUBE SHORTS
- youtubeTitle: 60 characters maximum, no hashtags: the hook with the main search word.
- youtubeDescription: 1–2 sentences with natural keywords, no hashtags.
- youtubeHashtags: exactly 3, without the # sign, specific to this video.

LANGUAGE: write everything in ${language(languageCode).englishName}.

OUTPUT: return ONLY the JSON object defined by the response schema.`;
}

export type PublishSource = Pick<ProductionSummary, "title" | "synopsis" | "story" | "params" | "characters">;

export function buildPublishPrompt(production: PublishSource, previous: PublishKit | null): string {
  const story = production.story;
  const supporting = story.supportingCharacters ?? [];
  return [
    "Write the publishing copy for this video.",
    "",
    `- Title: ${production.title}`,
    `- Synopsis: ${production.synopsis}`,
    field("Opening hook of the video", story.hook),
    field("Punchline (do NOT reveal it)", story.punchline),
    `- Comedy style: ${comedyStyle(production.params.comedyStyle).prompt}`,
    `- Main characters: ${production.characters.map((c) => `${c.name} (${c.species})`).join(", ")}`,
    supporting.length ? `- Supporting characters: ${supporting.map((c) => `${c.name} (${c.fruit})`).join(", ")}` : null,
    previous
      ? `\nPREVIOUS PROPOSAL (the user wants something clearly different, with another angle):\n${previous.tiktok}\n${previous.youtubeTitle}`
      : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Message de correction envoye si la premiere reponse ne passe pas la validation. */
export function buildRepairPrompt(issues: string[]): string {
  return `Your previous JSON does not satisfy the requirements:
${issues.map((i) => `- ${i}`).join("\n")}
Return the COMPLETE corrected JSON object (not a diff), following the response schema exactly.`;
}
