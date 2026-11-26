/** Listes de reference partagees par l'interface et les services. */
import type { AngleKey, ComedyStyle, FitMode } from "@/types";

export interface ComedyStyleOption {
  value: ComedyStyle;
  label: string;
  hint: string;
  /** Consigne envoyee a Gemini (anglais, plus precis pour le modele). */
  prompt: string;
}

export const COMEDY_STYLES: ComedyStyleOption[] = [
  {
    value: "mixed",
    label: "Mixte",
    hint: "Le meilleur de chaque style au service de l'histoire",
    prompt: "Mixed comedy: blend whichever comedy styles best serve the story (absurdity, drama, slapstick, twists).",
  },
  {
    value: "absurd",
    label: "Humour absurde",
    hint: "Logique surréaliste prise très au sérieux",
    prompt: "Absurd humor: surreal logic taken completely seriously by the characters, escalating nonsense with a deadpan tone.",
  },
  {
    value: "relationship_drama",
    label: "Drame relationnel",
    hint: "Jalousie, malentendus, émotions exagérées",
    prompt: "Relationship drama: soap-opera level feelings, jealousy, misunderstandings and over-the-top emotional reactions between the characters.",
  },
  {
    value: "betrayal",
    label: "Trahison",
    hint: "Un double jeu révélé avec fracas",
    prompt: "Betrayal: one character secretly double-crosses another; build suspicion, then a dramatic, funny reveal with exaggerated reactions.",
  },
  {
    value: "parody",
    label: "Parodie",
    hint: "Parodie de genre : télé-réalité, documentaire, cuisine…",
    prompt: "Parody: spoof a recognizable genre or format (reality TV confessional, nature documentary, cooking show, true-crime, action trailer) without naming real brands, shows or people.",
  },
  {
    value: "twist",
    label: "Retournements inattendus",
    hint: "On installe une attente… puis on la renverse",
    prompt: "Unexpected twists: set up a clear expectation, then subvert it — ideally twice, with the biggest twist as the final punchline.",
  },
  {
    value: "slapstick",
    label: "Slapstick",
    hint: "Comique physique, chutes, rebonds",
    prompt: "Slapstick: physical comedy — pratfalls, rolling, bouncing, squishing, exaggerated cartoon impacts (always harmless and cartoon-safe).",
  },
  {
    value: "dark",
    label: "Humour noir (léger)",
    hint: "Ironie mordante, jamais graphique",
    prompt: "Light dark comedy: morbid irony about fruit life (being peeled, blended, eaten, going overripe) — strictly cartoonish, non-graphic, no gore, no real-world violence.",
  },
];

export function comedyStyle(value: string | undefined): ComedyStyleOption {
  return COMEDY_STYLES.find((s) => s.value === value) ?? COMEDY_STYLES[0];
}

export interface LanguageOption {
  code: string;
  label: string;
  englishName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "fr", label: "Français", englishName: "French" },
  { code: "en", label: "Anglais", englishName: "English" },
  { code: "es", label: "Espagnol", englishName: "Spanish" },
  { code: "de", label: "Allemand", englishName: "German" },
  { code: "it", label: "Italien", englishName: "Italian" },
  { code: "pt", label: "Portugais", englishName: "Portuguese" },
];

export function language(code: string | undefined): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export interface AngleOption {
  value: AngleKey;
  label: string;
  english: string;
}

export const ANGLES: AngleOption[] = [
  { value: "sheet", label: "Fiche modèle", english: "character model sheet (front, three-quarter and profile views)" },
  { value: "front", label: "Face", english: "front view" },
  { value: "three_quarter", label: "Trois-quarts", english: "three-quarter view" },
  { value: "left", label: "Profil gauche", english: "left profile" },
  { value: "right", label: "Profil droit", english: "right profile" },
  { value: "back", label: "Dos", english: "back view" },
  { value: "expression", label: "Expression", english: "expression sheet" },
  { value: "pose", label: "Pose", english: "pose" },
  { value: "other", label: "Autre", english: "other reference" },
];

export function angle(value: string | undefined): AngleOption {
  return ANGLES.find((a) => a.value === value) ?? ANGLES[ANGLES.length - 1];
}

/** Fruits tires au sort pour les personnages inventes (`en` pour Gemini, `fr` pour reconnaitre le casting). */
export const SUPPORTING_FRUITS: { en: string; fr: string }[] = [
  { en: "strawberry", fr: "fraise" },
  { en: "pineapple", fr: "ananas" },
  { en: "kiwi", fr: "kiwi" },
  { en: "watermelon", fr: "pastèque" },
  { en: "orange", fr: "orange" },
  { en: "lemon", fr: "citron" },
  { en: "cherry", fr: "cerise" },
  { en: "grape", fr: "raisin" },
  { en: "mango", fr: "mangue" },
  { en: "peach", fr: "pêche" },
  { en: "pear", fr: "poire" },
  { en: "coconut", fr: "noix de coco" },
  { en: "avocado", fr: "avocat" },
  { en: "plum", fr: "prune" },
  { en: "apricot", fr: "abricot" },
  { en: "pomegranate", fr: "grenade" },
  { en: "blueberry", fr: "myrtille" },
  { en: "raspberry", fr: "framboise" },
  { en: "fig", fr: "figue" },
  { en: "apple", fr: "pomme" },
  { en: "banana", fr: "banane" },
  { en: "tomato", fr: "tomate" },
];

/** Tire au sort des fruits differents de ceux du casting. */
export function pickSupportingFruits(count: number, castSpecies: string[], random: () => number = Math.random): string[] {
  const cast = castSpecies.join(" ").toLowerCase();
  const pool = SUPPORTING_FRUITS.filter((f) => !cast.includes(f.fr) && !cast.includes(f.en));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((f) => f.en);
}

export const FIT_MODES: { value: FitMode; label: string; hint: string }[] = [
  { value: "blur", label: "Fond flou", hint: "Tout le cadre est conservé, fond flouté si le format diffère" },
  { value: "fill", label: "Remplir", hint: "Recadre pour remplir le 9:16" },
  { value: "fit", label: "Bandes noires", hint: "Tout le cadre est conservé, bandes noires" },
];

export const TRANSITIONS: { value: string; label: string }[] = [
  { value: "none", label: "Aucune (coupe franche)" },
  { value: "fade", label: "Fondu enchaîné" },
  { value: "fadeblack", label: "Fondu au noir" },
  { value: "fadewhite", label: "Fondu au blanc" },
  { value: "smoothleft", label: "Glissement vers la gauche" },
  { value: "slideup", label: "Glissement vers le haut" },
  { value: "circleopen", label: "Ouverture en cercle" },
];

export const RESOLUTIONS: { label: string; width: number; height: number }[] = [
  { label: "1080 × 1920 (Full HD vertical)", width: 1080, height: 1920 },
  { label: "720 × 1280 (HD vertical)", width: 720, height: 1280 },
  { label: "1440 × 2560 (2K vertical)", width: 1440, height: 2560 },
];

export const FRAME_RATES = [24, 25, 30, 60];

export const CHARACTER_COLORS = [
  "#B7F36B",
  "#FF9B54",
  "#FF6B7A",
  "#FFD166",
  "#7BDFF2",
  "#B497FF",
  "#F49CDD",
  "#6EE7B7",
];

/** Couleur d'interface attribuee a un nouveau personnage (stable pour un meme nom). */
export function characterColorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return CHARACTER_COLORS[hash % CHARACTER_COLORS.length];
}

/** Suggestion de modeles Flash quand la liste distante n'est pas encore chargee. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
