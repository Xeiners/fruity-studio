/**
 * Composition deterministe du prompt Google Flow final d'un clip :
 * en-tete de format + style + descripteurs canoniques des personnages presents
 * (repetes mot pour mot dans chaque clip pour la coherence visuelle) + scene
 * ecrite par Gemini.
 */
import { language } from "@/utils/catalog";
import type { CharacterDescriptor, ClipContent, PublishCopy, PublishKit } from "./schemas";

export interface ComposeOptions {
  clip: Pick<ClipContent, "clipNumber" | "charactersPresent" | "googleFlowPrompt">;
  clipCount: number;
  clipDuration: number;
  visualStyle: string;
  descriptors: CharacterDescriptor[];
  /** Langue effective du prompt ("en" ou code de la langue de l'histoire). */
  promptLanguage: string;
  storyLanguage: string;
  /** Personnages disposant d'images de reference dans la bibliotheque. */
  charactersWithReferences: string[];
}

function sameName(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

export function composeFlowPrompt(opts: ComposeOptions): string {
  const fr = opts.promptLanguage === "fr";
  const present = opts.clip.charactersPresent;
  const descriptors = present
    .map((name) => opts.descriptors.find((d) => sameName(d.name, name)))
    .filter((d): d is CharacterDescriptor => Boolean(d));
  const withRefs = present.filter((name) => opts.charactersWithReferences.some((r) => sameName(r, name)));
  const storyLang = language(opts.storyLanguage);
  const n = opts.clip.clipNumber;
  const total = opts.clipCount;
  const lines: string[] = [];

  if (fr) {
    lines.push(
      `Vidéo verticale 9:16, durée exacte ${opts.clipDuration} secondes. Clip ${n} sur ${total} d'une seule histoire continue${n > 1 ? " : il enchaîne exactement sur le clip précédent" : ""}.`,
    );
    if (opts.visualStyle.trim()) lines.push(`Style visuel : ${opts.visualStyle.trim()}`);
    if (descriptors.length) {
      lines.push("Personnages (apparence strictement identique dans tous les clips) :");
      for (const d of descriptors) {
        lines.push(`- ${d.name} : ${d.visualDescriptor}${d.voiceDescriptor ? ` Voix : ${d.voiceDescriptor}` : ""}`);
      }
    }
    if (withRefs.length) {
      lines.push(
        `Si des images de référence de ${joinNames(withRefs, "et")} sont fournies, respecter exactement leur apparence.`,
      );
    }
    lines.push(`Tous les dialogues sont parlés en ${storyLang.label.toLowerCase()}, avec une synchronisation labiale précise.`);
    lines.push("Pas de sous-titres, ni de texte à l'écran, ni de filigrane.");
  } else {
    lines.push(
      `Vertical 9:16 video, exactly ${opts.clipDuration} seconds long. Clip ${n} of ${total} of one continuous story${n > 1 ? " — it continues seamlessly from the previous clip" : ""}.`,
    );
    if (opts.visualStyle.trim()) lines.push(`Visual style: ${opts.visualStyle.trim()}`);
    if (descriptors.length) {
      lines.push("Characters (keep their appearance identical in every clip):");
      for (const d of descriptors) {
        lines.push(`- ${d.name}: ${d.visualDescriptor}${d.voiceDescriptor ? ` Voice: ${d.voiceDescriptor}` : ""}`);
      }
    }
    if (withRefs.length) {
      lines.push(`If reference images of ${joinNames(withRefs, "and")} are provided, match their appearance exactly.`);
    }
    lines.push(`All spoken dialogue is in ${storyLang.englishName}, with accurate lip-sync.`);
    lines.push("No subtitles, no captions, no on-screen text, no watermark.");
  }

  return `${lines.join("\n")}\n\n${opts.clip.googleFlowPrompt.trim()}`;
}

/**
 * Prompt unique a coller dans Google Flow (section personnage) : une seule image
 * montrant le personnage de face, de trois-quarts et de profil.
 */
export function composeCharacterModelSheetPrompt(opts: { name: string; canonicalVisual: string; promptLanguage: string }): string {
  const canonical = opts.canonicalVisual.trim();
  const lines =
    opts.promptLanguage === "fr"
      ? [
          `Fiche modèle du personnage ${opts.name}, un fruit anthropomorphe, personnage 3D cartoon haut de gamme, qualité de film d'animation, design simple et épuré.`,
          "Une seule image au format paysage 16:9 montrant le MÊME personnage trois fois côte à côte, en pied, à la même échelle et bien espacé : à gauche vue de face, au centre vue de trois-quarts, à droite vue de profil strict tournée vers la gauche.",
          `Personnage : ${canonical}`,
          "Personnage strictement identique dans les trois vues : même forme, même visage, mêmes proportions, mêmes couleurs. Même pose debout détendue et même léger sourire, corps entier visible.",
          "Décor : fond de studio uni gris clair, éclairage doux et homogène, ombres douces au sol.",
          "Ne rien ajouter qui ne soit pas décrit ci-dessus. Pas de texte, ni d'étiquette, ni de filigrane, ni d'autre personnage.",
        ]
      : [
          `Character model sheet of ${opts.name}, an anthropomorphic fruit character, premium 3D cartoon, animated feature film quality, simple clean design.`,
          "One single 16:9 landscape image showing the SAME character three times side by side, full body, same scale, evenly spaced: on the left a front view, in the center a three-quarter view, on the right a strict side profile view facing left.",
          `Character: ${canonical}`,
          "Keep the character strictly identical in all three views: same shape, same face, same proportions, same colors. Same relaxed standing pose and same gentle smile, whole body visible.",
          "Background: plain seamless light gray studio backdrop, soft even lighting, soft ground shadows.",
          "Do not add anything that is not described above. No text, no labels, no watermark, no other characters.",
        ];
  return lines.join("\n");
}

/** Limite imposee par YouTube sur la longueur d'un titre. */
const YOUTUBE_TITLE_MAX = 100;

function withoutHashtags(text: string): string {
  return text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
}

/** Sans diese ni accent, en minuscules, sans doublon : la forme sous laquelle un hashtag se recherche. */
function cleanHashtags(tags: string[], max: number): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const clean = tag.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (clean.length >= 2) unique.add(clean);
  }
  return [...unique].slice(0, max).map((tag) => `#${tag}`);
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Assemble le texte pret a coller, quelle que soit la forme exacte renvoyee par Gemini. */
export function finalizePublishKit(copy: PublishCopy, model: string): PublishKit {
  const tiktokTags = cleanHashtags(copy.tiktokHashtags, 5).join(" ");
  const youtubeTags = cleanHashtags(["shorts", ...copy.youtubeHashtags], 4).join(" ");
  return {
    tiktok: `${withoutHashtags(copy.tiktokCaption)}\n\n${tiktokTags}`,
    youtubeTitle: cutAtWord(withoutHashtags(copy.youtubeTitle), YOUTUBE_TITLE_MAX),
    youtubeDescription: `${withoutHashtags(copy.youtubeDescription)}\n\n${youtubeTags}`,
    model,
  };
}

/** Estimation grossiere du nombre de tokens (≈ 4 caracteres par token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
