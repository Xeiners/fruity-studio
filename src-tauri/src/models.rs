//! Structures echangees avec le frontend (serialisees en camelCase).

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Medias
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub kind: String,
    pub file_path: String,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub has_audio: Option<bool>,
    pub thumbnail_path: Option<String>,
    pub parent_id: Option<String>,
    pub character_id: Option<String>,
    pub production_id: Option<String>,
    pub label: String,
    pub caption: String,
    pub sort_order: i64,
    pub created_at: String,
    pub file_exists: bool,
}

/// Element de la mediatheque : un media et ses entites liees.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    #[serde(flatten)]
    pub asset: MediaAsset,
    pub character_name: Option<String>,
    pub production_title: Option<String>,
    pub clip_number: Option<i64>,
}

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    pub species: String,
    pub short_description: String,
    pub personality: String,
    pub behavior: String,
    pub voice: String,
    pub mannerisms: String,
    pub appearance: String,
    pub distinctive_details: String,
    pub creative_notes: String,
    pub color: String,
    pub cover_image_id: Option<String>,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
    /// "draft" (images a terminer) ou "ready".
    pub status: String,
    pub active_generation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSummary {
    #[serde(flatten)]
    pub character: Character,
    pub cover_path: Option<String>,
    pub image_count: i64,
    pub production_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterInput {
    pub name: String,
    #[serde(default)]
    pub species: String,
    #[serde(default)]
    pub short_description: String,
    #[serde(default)]
    pub personality: String,
    #[serde(default)]
    pub voice: String,
    // Champs de l'ancienne fiche : `None` les laisse intacts lors d'une mise a jour.
    #[serde(default)]
    pub behavior: Option<String>,
    #[serde(default)]
    pub mannerisms: Option<String>,
    #[serde(default)]
    pub appearance: Option<String>,
    #[serde(default)]
    pub distinctive_details: Option<String>,
    #[serde(default)]
    pub creative_notes: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

/// Une version de l'identite generee par Gemini et de ses prompts d'image.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterGeneration {
    pub id: String,
    pub character_id: String,
    pub version: i64,
    pub instruction: String,
    pub model: String,
    pub brief: Value,
    pub identity: Value,
    pub prompts: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterGenerationInput {
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub model: String,
    pub brief: Value,
    pub identity: Value,
    pub prompts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    pub id: String,
    /// "outgoing" : defini sur ce personnage ; "incoming" : defini par l'autre personnage.
    pub direction: String,
    pub character_id: String,
    pub related_character_id: String,
    pub related_name: String,
    pub related_species: String,
    pub related_color: String,
    pub related_cover_path: Option<String>,
    pub relation: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipInput {
    pub related_character_id: String,
    pub relation: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionRef {
    pub id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDetail {
    #[serde(flatten)]
    pub character: Character,
    pub cover_path: Option<String>,
    pub images: Vec<MediaAsset>,
    pub relationships: Vec<Relationship>,
    pub productions: Vec<ProductionRef>,
    /// De la plus recente a la plus ancienne.
    pub generations: Vec<CharacterGeneration>,
}

// ---------------------------------------------------------------------------
// Productions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Production {
    pub id: String,
    pub title: String,
    pub status: String,
    pub synopsis: String,
    pub target_duration: i64,
    pub clip_duration: i64,
    pub params: Value,
    pub story: Value,
    pub render_settings: Value,
    pub final_video_id: Option<String>,
    pub rendered_at: Option<String>,
    pub thumbnail_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRef {
    pub id: String,
    pub name: String,
    pub species: String,
    pub color: String,
    pub cover_path: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub production_id: String,
    pub clip_number: i64,
    pub duration: i64,
    pub content: Value,
    pub flow_prompt: String,
    pub prompt_edited: bool,
    pub video_asset_id: Option<String>,
    pub video_imported_at: Option<String>,
    pub video: Option<MediaAsset>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionSummary {
    #[serde(flatten)]
    pub production: Production,
    pub clip_count: i64,
    pub imported_count: i64,
    pub preview_thumbnail: Option<String>,
    pub final_video_path: Option<String>,
    pub characters: Vec<CharacterRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionDetail {
    #[serde(flatten)]
    pub production: Production,
    pub clips: Vec<Clip>,
    pub characters: Vec<CharacterRef>,
    pub final_video: Option<MediaAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInput {
    pub clip_number: i64,
    pub duration: i64,
    pub content: Value,
    pub flow_prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionCreateInput {
    pub title: String,
    #[serde(default)]
    pub synopsis: String,
    pub target_duration: i64,
    pub clip_duration: i64,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub story: Value,
    pub character_ids: Vec<String>,
    #[serde(default)]
    pub clips: Vec<ClipInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionUpdateInput {
    pub title: Option<String>,
    pub synopsis: Option<String>,
    pub params: Option<Value>,
    pub story: Option<Value>,
    pub render_settings: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryReplaceInput {
    pub title: Option<String>,
    pub synopsis: String,
    pub target_duration: i64,
    pub clip_duration: i64,
    pub params: Value,
    pub story: Value,
    pub character_ids: Vec<String>,
    pub clips: Vec<ClipInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipUpdateInput {
    pub content: Option<Value>,
    pub flow_prompt: Option<String>,
    pub prompt_edited: Option<bool>,
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub characters: i64,
    pub archived_characters: i64,
    pub productions: i64,
    pub completed_videos: i64,
    pub draft_productions: i64,
    pub reference_images: i64,
    pub imported_clips: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub database_path: String,
    pub schema_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceExportRequest {
    pub title: String,
    pub character_ids: Vec<String>,
    /// Sous-ensemble d'images a exporter ; `None` = toutes les images des personnages.
    pub asset_ids: Option<Vec<String>>,
    pub dest_dir: Option<String>,
    /// Texte additionnel ecrit dans LISEZMOI.txt (ex. prompts de la production).
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceExportResult {
    pub folder: String,
    pub file_count: usize,
}
