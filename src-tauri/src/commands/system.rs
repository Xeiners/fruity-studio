use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::blocking;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::FfmpegInfo;
use crate::models::{AppInfo, DashboardStats};
use crate::repo;
use crate::settings::{self, AppSettings};
use crate::state::AppState;
use crate::util::{extension_lower, is_within, path_to_string};

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: path_to_string(&state.data_dir),
        database_path: path_to_string(&state.db_path),
        schema_version: db::schema_version(&*state.conn()?)?,
    })
}

#[tauri::command]
pub async fn dashboard_stats(state: State<'_, AppState>) -> AppResult<DashboardStats> {
    repo::dashboard_stats(&*state.conn()?)
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.settings()
}

#[tauri::command]
pub async fn settings_update(app: AppHandle, state: State<'_, AppState>, settings: AppSettings) -> AppResult<AppSettings> {
    let mut next = settings;
    next.workspace_dir = next.workspace_dir.trim().to_string();
    next.export_dir = next.export_dir.trim().to_string();
    next.gemini_model = next.gemini_model.trim().to_string();
    next.ffmpeg_path = next.ffmpeg_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    next.validate()?;
    std::fs::create_dir_all(&next.workspace_dir).map_err(|e| {
        AppError::validation(format!("Impossible de créer le dossier de travail : {e}"))
    })?;
    std::fs::create_dir_all(&next.export_dir).map_err(|e| {
        AppError::validation(format!("Impossible de créer le dossier d'export : {e}"))
    })?;
    let previous = state.settings()?;
    settings::save(&*state.conn()?, &next)?;
    if previous.ffmpeg_path != next.ffmpeg_path {
        if let Ok(mut cache) = state.ffmpeg.lock() {
            *cache = None;
        }
    }
    state.allow_media_scope(&app)?;
    Ok(next)
}

#[tauri::command]
pub async fn ffmpeg_detect(app: AppHandle, force: bool) -> AppResult<FfmpegInfo> {
    blocking(move || {
        use tauri::Manager;
        app.state::<AppState>().ffmpeg_info(force)
    })
    .await
}

/// Un chemin peut etre ouvert/revele s'il appartient a l'espace de travail, au
/// dossier d'export, ou a un media connu de l'application.
fn ensure_allowed(state: &AppState, path: &Path) -> AppResult<()> {
    let s = state.settings()?;
    if is_within(path, Path::new(&s.workspace_dir)) || is_within(path, Path::new(&s.export_dir)) {
        return Ok(());
    }
    let p = path_to_string(path);
    let known: i64 = state.conn()?.query_row(
        "SELECT COUNT(*) FROM media_assets WHERE file_path = ?1 OR thumbnail_path = ?1",
        rusqlite::params![p],
        |r| r.get(0),
    )?;
    if known > 0 || is_within(path, &state.data_dir) || is_within(path, &state.tools_dir) {
        Ok(())
    } else {
        Err(AppError::validation("Ce chemin n'est pas géré par Fruity Studio."))
    }
}

#[tauri::command]
pub async fn reveal_path(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    ensure_allowed(&state, &p)?;
    if !p.exists() {
        return Err(AppError::not_found(format!("Introuvable : {path}")));
    }
    let result = if p.is_dir() {
        app.opener().open_path(path_to_string(&p), None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&p)
    };
    result.map_err(|e| AppError::Other(format!("Impossible d'ouvrir l'explorateur : {e}")))
}

#[tauri::command]
pub async fn open_path(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    ensure_allowed(&state, &p)?;
    if !p.exists() {
        return Err(AppError::not_found(format!("Introuvable : {path}")));
    }
    app.opener()
        .open_path(path_to_string(&p), None::<&str>)
        .map_err(|e| AppError::Other(format!("Impossible d'ouvrir le fichier : {e}")))
}

/// Ecrit un fichier texte choisi par l'utilisateur (export des prompts).
#[tauri::command]
pub async fn export_text_file(path: String, contents: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    let ext = extension_lower(&p);
    if !matches!(ext.as_str(), "txt" | "md" | "json") {
        return Err(AppError::validation("Seuls les fichiers .txt, .md et .json peuvent être exportés."));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if ext == "json" {
        std::fs::write(&p, contents.as_bytes())?;
        return Ok(());
    }
    // BOM UTF-8 + fins de ligne Windows pour un affichage correct dans le Bloc-notes.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(contents.replace("\r\n", "\n").replace('\n', "\r\n").as_bytes());
    std::fs::write(&p, bytes)?;
    Ok(())
}
