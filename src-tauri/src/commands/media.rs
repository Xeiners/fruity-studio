use std::path::Path;

use tauri::{AppHandle, Manager, State};

use super::{ImportFailure, ImportReport, blocking};
use crate::error::{AppError, AppResult};
use crate::ffmpeg::probe;
use crate::media::{self, AUDIO_EXTS};
use crate::models::{MediaAsset, MediaItem};
use crate::repo::{self, media::NewAsset};
use crate::state::AppState;
use crate::util::path_to_string;

const KINDS: &[&str] = &["character_image", "clip_video", "render", "music", "sfx", "thumbnail"];

#[tauri::command]
pub async fn media_list(
    state: State<'_, AppState>,
    kind: Option<String>,
    query: Option<String>,
) -> AppResult<Vec<MediaItem>> {
    if let Some(k) = kind.as_deref() {
        if !KINDS.contains(&k) {
            return Err(AppError::validation("Type de média inconnu."));
        }
    }
    repo::media::list(&*state.conn()?, kind.as_deref(), query.as_deref())
}

/// Importe des musiques ou effets sonores dans la mediatheque.
#[tauri::command]
pub async fn media_import_audio(app: AppHandle, paths: Vec<String>, kind: String) -> AppResult<ImportReport<MediaAsset>> {
    if kind != "music" && kind != "sfx" {
        return Err(AppError::validation("Type audio inconnu."));
    }
    blocking(move || {
        let state = app.state::<AppState>();
        let dest = state.workspace()?.audio_dir()?;
        state.allow_directory(&app, &dest);
        let ffprobe = state.ffmpeg_paths()?.map(|(_, p)| p);
        let mut imported = Vec::new();
        let mut failures = Vec::new();
        for raw in paths {
            let result = (|| -> AppResult<MediaAsset> {
                let source = media::inspect_source(Path::new(&raw), AUDIO_EXTS, "un fichier audio")?;
                let existing = media::find_existing(&*state.conn()?, &source.sha256, &kind)?;
                let stored = match existing {
                    Some(p) => p,
                    None => media::copy_into(&source, &dest)?,
                };
                let duration_ms = ffprobe
                    .as_ref()
                    .and_then(|fp| probe::probe(fp, &stored).ok())
                    .map(|info| (info.duration * 1000.0).round() as i64);
                repo::media::insert(
                    &*state.conn()?,
                    &NewAsset {
                        kind: kind.clone(),
                        file_path: path_to_string(&stored),
                        original_name: source.original_name.clone(),
                        mime_type: source.mime.clone(),
                        size_bytes: source.size,
                        sha256: Some(source.sha256.clone()),
                        duration_ms,
                        has_audio: Some(true),
                        ..Default::default()
                    },
                )
            })();
            match result {
                Ok(asset) => imported.push(asset),
                Err(e) => failures.push(ImportFailure { path: raw, message: e.to_string() }),
            }
        }
        Ok(ImportReport { imported, failures })
    })
    .await
}

#[tauri::command]
pub async fn media_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = state.conn()?;
    let asset = repo::media::require(&conn, &id)?;
    if asset.kind == "thumbnail" && asset.parent_id.is_some() {
        return Err(AppError::validation(
            "Cette miniature est liée à une vidéo : supprimez la vidéo pour la retirer.",
        ));
    }
    let tx = conn.unchecked_transaction()?;
    repo::media::delete(&tx, &id)?;
    tx.commit()?;
    Ok(())
}
