/**
 * Types du domaine, miroir des structures Rust (serialisees en camelCase).
 * Les contenus generes par Gemini (histoire, clips) sont types dans
 * `services/gemini/schemas.ts` et valides a l'execution avec Zod.
 */

import type { CharacterImagePrompt, ClipContent, StoredCharacterIdentity, StoryContent } from "@/services/gemini/schemas";

export type MediaKind = "character_image" | "clip_video" | "render" | "music" | "sfx" | "thumbnail";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  filePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean | null;
  thumbnailPath: string | null;
  parentId: string | null;
  characterId: string | null;
  productionId: string | null;
  label: string;
  caption: string;
  sortOrder: number;
  createdAt: string;
  fileExists: boolean;
}

export interface MediaItem extends MediaAsset {
  characterName: string | null;
  productionTitle: string | null;
  clipNumber: number | null;
}

export interface ImportFailure {
  path: string;
  message: string;
}

export interface ImportReport<T> {
  imported: T[];
  failures: ImportFailure[];
}

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

export interface Character {
  id: string;
  name: string;
  species: string;
  shortDescription: string;
  personality: string;
  behavior: string;
  voice: string;
  mannerisms: string;
  appearance: string;
  distinctiveDetails: string;
  creativeNotes: string;
  color: string;
  coverImageId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  status: CharacterStatus;
  activeGenerationId: string | null;
}

export type CharacterStatus = "draft" | "ready";

export interface CharacterSummary extends Character {
  coverPath: string | null;
  imageCount: number;
  productionCount: number;
}

/** Ce que l'utilisateur saisit : le reste est developpe par Gemini. */
export type CharacterEssentials = Pick<Character, "name" | "species" | "shortDescription" | "personality" | "voice">;

/** Champs de l'ancienne fiche, conserves pour les personnages deja enregistres. */
export type CharacterOlderNotes = Pick<Character, "behavior" | "mannerisms" | "appearance" | "distinctiveDetails" | "creativeNotes">;

/** Les champs de l'ancienne fiche omis ici restent inchanges. */
export type CharacterInput = CharacterEssentials & Partial<CharacterOlderNotes> & { color?: string | null };

/** Une version generee : description de reference et prompt du modele. */
export interface CharacterGeneration {
  id: string;
  characterId: string;
  version: number;
  instruction: string;
  model: string;
  brief: Partial<CharacterEssentials>;
  identity: Partial<StoredCharacterIdentity>;
  prompts: CharacterImagePrompt[];
  createdAt: string;
  updatedAt: string;
}

export interface CharacterGenerationInput {
  instruction: string;
  model: string;
  brief: CharacterEssentials;
  identity: StoredCharacterIdentity;
  prompts: CharacterImagePrompt[];
}

export interface Relationship {
  id: string;
  direction: "outgoing" | "incoming";
  characterId: string;
  relatedCharacterId: string;
  relatedName: string;
  relatedSpecies: string;
  relatedColor: string;
  relatedCoverPath: string | null;
  relation: string;
  description: string;
}

export interface RelationshipInput {
  relatedCharacterId: string;
  relation: string;
  description: string;
}

export interface ProductionRef {
  id: string;
  title: string;
  status: ProductionStatus;
  updatedAt: string;
}

export interface CharacterDetail extends Character {
  coverPath: string | null;
  images: MediaAsset[];
  relationships: Relationship[];
  productions: ProductionRef[];
  /** De la plus recente a la plus ancienne. */
  generations: CharacterGeneration[];
}

export type AngleKey = "sheet" | "front" | "back" | "left" | "right" | "three_quarter" | "expression" | "pose" | "other";

// ---------------------------------------------------------------------------
// Productions
// ---------------------------------------------------------------------------

export type ProductionStatus = "draft" | "generated" | "rendered";

export type ComedyStyle =
  | "absurd"
  | "relationship_drama"
  | "betrayal"
  | "parody"
  | "twist"
  | "slapstick"
  | "dark"
  | "mixed";

export type MusicMode = "flow" | "post";
export type PromptLanguage = "en" | "story";

/** Parametres de generation memorises avec la production. */
export interface ProductionParams {
  storyIdea: string;
  comedyStyle: ComedyStyle;
  language: string;
  promptLanguage: PromptLanguage;
  musicMode: MusicMode;
  additionalInstructions: string;
  /** Gemini invente des fruits au hasard qui interagissent avec le casting. */
  inventCharacters: boolean;
  continuityProductionId: string | null;
  model: string;
  generatedAt: string;
}

export interface CharacterRef {
  id: string;
  name: string;
  species: string;
  color: string;
  coverPath: string | null;
  archived: boolean;
}

export interface Clip {
  id: string;
  productionId: string;
  clipNumber: number;
  duration: number;
  content: ClipContent | Record<string, never>;
  flowPrompt: string;
  promptEdited: boolean;
  videoAssetId: string | null;
  videoImportedAt: string | null;
  video: MediaAsset | null;
  createdAt: string;
  updatedAt: string;
}

export interface Production {
  id: string;
  title: string;
  status: ProductionStatus;
  synopsis: string;
  targetDuration: number;
  clipDuration: number;
  params: Partial<ProductionParams>;
  story: Partial<StoryContent>;
  renderSettings: Partial<RenderOptions>;
  finalVideoId: string | null;
  renderedAt: string | null;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSummary extends Production {
  clipCount: number;
  importedCount: number;
  previewThumbnail: string | null;
  finalVideoPath: string | null;
  characters: CharacterRef[];
}

export interface ProductionDetail extends Production {
  clips: Clip[];
  characters: CharacterRef[];
  finalVideo: MediaAsset | null;
}

export interface ClipInput {
  clipNumber: number;
  duration: number;
  content: ClipContent;
  flowPrompt: string;
}

export interface ProductionCreateInput {
  title: string;
  synopsis: string;
  targetDuration: number;
  clipDuration: number;
  params: ProductionParams;
  story: StoryContent;
  characterIds: string[];
  clips: ClipInput[];
}

export interface StoryReplaceInput extends Omit<ProductionCreateInput, "title"> {
  title: string | null;
}

export interface ProductionUpdateInput {
  title?: string;
  synopsis?: string;
  params?: Partial<ProductionParams>;
  story?: Partial<StoryContent>;
  renderSettings?: Partial<RenderOptions>;
}

export interface ClipUpdateInput {
  content?: ClipContent;
  flowPrompt?: string;
  promptEdited?: boolean;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

export type FitMode = "blur" | "fill" | "fit";

export interface RenderOptions {
  outputDir: string;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  fitMode: FitMode;
  transition: string;
  transitionDuration: number;
  normalizeAudio: boolean;
  clipVolume: number;
  musicAssetId: string | null;
  musicVolume: number;
  musicDucking: boolean;
  musicFadeOut: boolean;
}

export type RenderStage = "preparing" | "probing" | "encoding" | "finalizing" | "done" | "error" | "cancelled";

export interface RenderProgress {
  productionId: string;
  stage: RenderStage;
  percent: number;
  message: string;
}

export interface RenderResult {
  asset: MediaAsset;
  outputPath: string;
  durationMs: number;
  sizeBytes: number;
  strategy: "copy" | "reencode";
  warnings: string[];
  logPath: string | null;
}

// ---------------------------------------------------------------------------
// Parametres et systeme
// ---------------------------------------------------------------------------

export type ThemePreference = "dark" | "light" | "system";

export interface AppSettings {
  geminiModel: string;
  defaultLanguage: string;
  promptLanguage: PromptLanguage;
  defaultTargetDuration: number;
  defaultClipDuration: number;
  defaultComedyStyle: ComedyStyle;
  musicMode: MusicMode;
  ffmpegPath: string | null;
  workspaceDir: string;
  exportDir: string;
  videoWidth: number;
  videoHeight: number;
  frameRate: number;
  theme: ThemePreference;
}

export interface KeyStatus {
  configured: boolean;
  hint: string | null;
  storage: string;
}

export interface FfmpegInfo {
  found: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  source: string | null;
  h264Encoder: string | null;
  hasAac: boolean;
  searched: string[];
  error: string | null;
  /** Dossier de la copie installee par Fruity Studio. */
  managedDir: string | null;
  /** Une copie installee par Fruity Studio est presente. */
  managedInstalled: boolean;
  /** Installation automatique possible (Windows). */
  canAutoInstall: boolean;
}

export type FfmpegInstallStage =
  | "checking"
  | "downloading"
  | "verifying"
  | "extracting"
  | "testing"
  | "done"
  | "error"
  | "cancelled";

export interface FfmpegInstallProgress {
  stage: FfmpegInstallStage;
  downloaded: number;
  total: number | null;
  percent: number;
  message: string;
}

export interface FfmpegSelfTestResult {
  encoder: string;
  elapsedMs: number;
  width: number | null;
  height: number | null;
  durationMs: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  databasePath: string;
  schemaVersion: number;
}

export interface DashboardStats {
  characters: number;
  archivedCharacters: number;
  productions: number;
  completedVideos: number;
  draftProductions: number;
  referenceImages: number;
  importedClips: number;
}

export interface ReferenceExportRequest {
  title: string;
  characterIds: string[];
  assetIds: string[] | null;
  destDir: string | null;
  notes: string | null;
}

export interface ReferenceExportResult {
  folder: string;
  fileCount: number;
}
