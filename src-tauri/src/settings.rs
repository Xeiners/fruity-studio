//! Parametres applicatifs (hors secrets). Stockes en JSON dans la table `settings`.
//! La cle API Gemini n'est JAMAIS stockee ici : voir `secrets.rs`.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";
const SETTINGS_KEY: &str = "app_settings";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub gemini_model: String,
    pub default_language: String,
    /// "en" (recommande pour Veo) ou "story" (meme langue que l'histoire).
    pub prompt_language: String,
    pub default_target_duration: u32,
    pub default_clip_duration: u32,
    pub default_comedy_style: String,
    /// "flow" : musique generee par Flow ; "post" : musique ajoutee au montage.
    pub music_mode: String,
    pub ffmpeg_path: Option<String>,
    pub workspace_dir: String,
    pub export_dir: String,
    pub video_width: u32,
    pub video_height: u32,
    pub frame_rate: u32,
    /// "dark" | "light" | "system"
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            default_language: "fr".into(),
            prompt_language: "en".into(),
            default_target_duration: 30,
            default_clip_duration: 10,
            default_comedy_style: "mixed".into(),
            music_mode: "flow".into(),
            ffmpeg_path: None,
            workspace_dir: String::new(),
            export_dir: String::new(),
            video_width: 1080,
            video_height: 1920,
            frame_rate: 30,
            theme: "dark".into(),
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> AppResult<()> {
        if self.gemini_model.trim().is_empty() {
            return Err(AppError::validation("Le modèle Gemini ne peut pas être vide."));
        }
        if !(5..=600).contains(&self.default_target_duration) {
            return Err(AppError::validation("La durée cible doit être comprise entre 5 et 600 secondes."));
        }
        if !(2..=60).contains(&self.default_clip_duration) {
            return Err(AppError::validation("La durée d'un clip doit être comprise entre 2 et 60 secondes."));
        }
        if !(240..=4320).contains(&self.video_width) || !(240..=4320).contains(&self.video_height) {
            return Err(AppError::validation("La résolution vidéo est invalide."));
        }
        if self.video_width % 2 != 0 || self.video_height % 2 != 0 {
            return Err(AppError::validation("La résolution doit utiliser des dimensions paires."));
        }
        if !(12..=60).contains(&self.frame_rate) {
            return Err(AppError::validation("La fréquence d'images doit être comprise entre 12 et 60 i/s."));
        }
        if !matches!(self.theme.as_str(), "dark" | "light" | "system") {
            return Err(AppError::validation("Thème inconnu."));
        }
        if !matches!(self.prompt_language.as_str(), "en" | "story") {
            return Err(AppError::validation("Langue des prompts inconnue."));
        }
        if !matches!(self.music_mode.as_str(), "flow" | "post") {
            return Err(AppError::validation("Mode musique inconnu."));
        }
        if self.workspace_dir.trim().is_empty() || self.export_dir.trim().is_empty() {
            return Err(AppError::validation("Les dossiers de travail et d'export sont obligatoires."));
        }
        Ok(())
    }
}

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![SETTINGS_KEY], |r| r.get(0))
        .optional()?;
    match raw {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(AppSettings::default()),
    }
}

pub fn save(conn: &Connection, settings: &AppSettings) -> AppResult<()> {
    let json = serde_json::to_string(settings)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTINGS_KEY, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn roundtrip_and_defaults() {
        let conn = db::open_in_memory().unwrap();
        let loaded = load(&conn).unwrap();
        assert_eq!(loaded.gemini_model, DEFAULT_GEMINI_MODEL);
        assert_eq!(loaded.default_clip_duration, 10);

        let mut s = loaded.clone();
        s.workspace_dir = "C:/ws".into();
        s.export_dir = "C:/exports".into();
        s.theme = "light".into();
        s.validate().unwrap();
        save(&conn, &s).unwrap();
        assert_eq!(load(&conn).unwrap(), s);
    }

    #[test]
    fn rejects_invalid_values() {
        let mut s = AppSettings {
            workspace_dir: "C:/ws".into(),
            export_dir: "C:/ex".into(),
            ..Default::default()
        };
        s.video_width = 1081;
        assert!(s.validate().is_err());
    }

    #[test]
    fn unknown_fields_fall_back_to_defaults() {
        let s: AppSettings = serde_json::from_str(r#"{"theme":"light","legacy":true}"#).unwrap();
        assert_eq!(s.theme, "light");
        assert_eq!(s.frame_rate, 30);
    }
}
