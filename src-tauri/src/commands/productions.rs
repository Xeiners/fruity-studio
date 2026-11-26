use std::path::Path;

use tauri::{AppHandle, Manager, State};

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::{extract_thumbnail, probe};
use crate::media::{self, VIDEO_EXTS};
use crate::models::{
    Clip, ClipUpdateInput, Production, ProductionCreateInput, ProductionDetail, ProductionSummary,
    ProductionUpdateInput, StoryReplaceInput,
};
use crate::repo::{self, media::NewAsset};
use crate::state::AppState;
use crate::util::{new_id, path_to_string};

#[tauri::command]
pub async fn productions_list(state: State<'_, AppState>) -> AppResult<Vec<ProductionSummary>> {
    repo::productions::list(&*state.conn()?)
}

#[tauri::command]
pub async fn production_get(state: State<'_, AppState>, id: String) -> AppResult<ProductionDetail> {
    repo::productions::detail(&*state.conn()?, &id)
}

#[tauri::command]
pub async fn production_create(state: State<'_, AppState>, input: ProductionCreateInput) -> AppResult<ProductionDetail> {
    repo::productions::create(&*state.conn()?, &input)
}

#[tauri::command]
pub async fn production_update(
    state: State<'_, AppState>,
    id: String,
    input: ProductionUpdateInput,
) -> AppResult<Production> {
    repo::productions::update(&*state.conn()?, &id, &input)
}

#[tauri::command]
pub async fn production_replace_story(
    state: State<'_, AppState>,
    id: String,
    input: StoryReplaceInput,
) -> AppResult<ProductionDetail> {
    repo::productions::replace_story(&*state.conn()?, &id, &input)
}

#[tauri::command]
pub async fn production_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if let Ok(guard) = state.render_job.lock() {
        if guard.as_ref().is_some_and(|job| job.production_id == id) {
            return Err(AppError::validation("Un rendu est en cours pour cette production. Annulez-le d'abord."));
        }
    }
    {
        let conn = state.conn()?;
        let tx = conn.unchecked_transaction()?;
        repo::productions::delete(&tx, &id)?;
        tx.commit()?;
    }
    if let Ok(ws) = state.workspace() {
        let dir = ws.root.join("productions").join(&id);
        if dir.is_dir() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn clip_update(state: State<'_, AppState>, clip_id: String, input: ClipUpdateInput) -> AppResult<Clip> {
    repo::productions::update_clip(&*state.conn()?, &clip_id, &input)
}

/// Importe la video generee par Google Flow pour un clip precis : copie dans
/// l'espace de travail, analyse ffprobe et miniature (si FFmpeg est disponible).
#[tauri::command]
pub async fn clip_import_video(app: AppHandle, clip_id: String, path: String) -> AppResult<Clip> {
    blocking(move || {
        let state = app.state::<AppState>();
        let clip = repo::productions::clip(&*state.conn()?, &clip_id)?;
        let source = media::inspect_source(Path::new(&path), VIDEO_EXTS, "une vidéo de clip")?;

        // Garde-fou : la meme video ne doit pas etre associee a deux clips differents.
        let duplicate: Option<i64> = {
            let conn = state.conn()?;
            rusqlite::OptionalExtension::optional(conn.query_row(
                "SELECT c.clip_number FROM clips c JOIN media_assets m ON m.id = c.video_asset_id
                 WHERE m.sha256 = ?1 AND c.production_id = ?2 AND c.id <> ?3 LIMIT 1",
                rusqlite::params![source.sha256, clip.production_id, clip_id],
                |r| r.get(0),
            ))?
        };
        if let Some(other) = duplicate {
            return Err(AppError::validation(format!(
                "Cette vidéo est déjà associée au clip {other}. Retirez-la de ce clip avant de l'importer ici."
            )));
        }

        let ws = state.workspace()?;
        let dest = ws.clips_dir(&clip.production_id)?;
        state.allow_directory(&app, &dest);

        let existing = media::find_existing(&*state.conn()?, &source.sha256, "clip_video")?;
        let stored = match existing {
            Some(p) => p,
            None => media::copy_into(&source, &dest)?,
        };

        // Analyse et miniature : optionnelles si FFmpeg n'est pas installe.
        let mut probe_info = None;
        let mut thumbnail = None;
        if let Some((ffmpeg, ffprobe)) = state.ffmpeg_paths()? {
            match probe::probe(&ffprobe, &stored) {
                Ok(info) => {
                    if !info.has_video {
                        return Err(AppError::validation("Ce fichier ne contient aucun flux vidéo."));
                    }
                    let thumbs = ws.thumbnails_dir()?;
                    state.allow_directory(&app, &thumbs);
                    let thumb_path = thumbs.join(format!("{}.jpg", new_id()));
                    let at = (info.duration / 2.0).clamp(0.0, 1.0);
                    if extract_thumbnail(&ffmpeg, &stored, &thumb_path, at).is_ok() {
                        thumbnail = Some(path_to_string(&thumb_path));
                    }
                    probe_info = Some(info);
                }
                Err(e) => {
                    return Err(AppError::validation(format!("Vidéo illisible : {e}")));
                }
            }
        }

        let conn = state.conn()?;
        let tx = conn.unchecked_transaction()?;
        let asset = repo::media::insert(
            &tx,
            &NewAsset {
                kind: "clip_video".into(),
                file_path: path_to_string(&stored),
                original_name: source.original_name.clone(),
                mime_type: source.mime.clone(),
                size_bytes: source.size,
                sha256: Some(source.sha256.clone()),
                width: probe_info.as_ref().and_then(|p| p.width),
                height: probe_info.as_ref().and_then(|p| p.height),
                duration_ms: probe_info.as_ref().map(|p| (p.duration * 1000.0).round() as i64),
                fps: probe_info.as_ref().and_then(|p| p.fps),
                video_codec: probe_info.as_ref().and_then(|p| p.video_codec.clone()),
                audio_codec: probe_info.as_ref().and_then(|p| p.audio_codec.clone()),
                has_audio: probe_info.as_ref().map(|p| p.has_audio),
                thumbnail_path: thumbnail.clone(),
                production_id: Some(clip.production_id.clone()),
                label: format!("clip-{}", clip.clip_number),
                ..Default::default()
            },
        )?;
        if let Some(thumb) = &thumbnail {
            repo::media::insert(
                &tx,
                &NewAsset {
                    kind: "thumbnail".into(),
                    file_path: thumb.clone(),
                    original_name: format!("Miniature clip {}", clip.clip_number),
                    mime_type: "image/jpeg".into(),
                    size_bytes: std::fs::metadata(thumb).map(|m| m.len() as i64).unwrap_or(0),
                    parent_id: Some(asset.id.clone()),
                    production_id: Some(clip.production_id.clone()),
                    ..Default::default()
                },
            )?;
        }
        let previous = repo::productions::set_clip_video(&tx, &clip_id, Some(&asset.id))?;
        if let Some(previous) = previous {
            if previous != asset.id && repo::media::get(&tx, &previous)?.is_some() {
                repo::media::delete(&tx, &previous)?;
            }
        }
        tx.commit()?;
        repo::productions::clip(&conn, &clip_id)
    })
    .await
}

/// Analyse (ffprobe + miniature) les videos importees avant l'installation de
/// FFmpeg. Renvoie le nombre de videos mises a jour.
#[tauri::command]
pub async fn production_analyze_clips(app: AppHandle, production_id: String) -> AppResult<usize> {
    blocking(move || {
        let state = app.state::<AppState>();
        let Some((ffmpeg, ffprobe)) = state.ffmpeg_paths()? else {
            return Ok(0);
        };
        let clips = repo::productions::clips(&*state.conn()?, &production_id)?;
        let thumbs = state.workspace()?.thumbnails_dir()?;
        state.allow_directory(&app, &thumbs);
        let mut updated = 0;
        for clip in clips {
            let Some(video) = clip.video else { continue };
            if video.duration_ms.is_some() || !video.file_exists {
                continue;
            }
            let Ok(info) = probe::probe(&ffprobe, Path::new(&video.file_path)) else { continue };
            let thumb_path = thumbs.join(format!("{}.jpg", new_id()));
            let thumbnail = extract_thumbnail(&ffmpeg, Path::new(&video.file_path), &thumb_path, (info.duration / 2.0).clamp(0.0, 1.0))
                .ok()
                .map(|_| path_to_string(&thumb_path));
            let conn = state.conn()?;
            conn.execute(
                "UPDATE media_assets SET width = ?2, height = ?3, duration_ms = ?4, fps = ?5, video_codec = ?6,
                    audio_codec = ?7, has_audio = ?8, thumbnail_path = COALESCE(?9, thumbnail_path) WHERE id = ?1",
                rusqlite::params![
                    video.id,
                    info.width,
                    info.height,
                    (info.duration * 1000.0).round() as i64,
                    info.fps,
                    info.video_codec,
                    info.audio_codec,
                    info.has_audio as i64,
                    thumbnail
                ],
            )?;
            if let Some(thumb) = &thumbnail {
                repo::media::insert(
                    &conn,
                    &NewAsset {
                        kind: "thumbnail".into(),
                        file_path: thumb.clone(),
                        original_name: format!("Miniature clip {}", clip.clip_number),
                        mime_type: "image/jpeg".into(),
                        size_bytes: std::fs::metadata(thumb).map(|m| m.len() as i64).unwrap_or(0),
                        parent_id: Some(video.id.clone()),
                        production_id: Some(production_id.clone()),
                        ..Default::default()
                    },
                )?;
            }
            updated += 1;
        }
        Ok(updated)
    })
    .await
}

#[tauri::command]
pub async fn clip_remove_video(state: State<'_, AppState>, clip_id: String) -> AppResult<Clip> {
    let conn = state.conn()?;
    let tx = conn.unchecked_transaction()?;
    let previous = repo::productions::set_clip_video(&tx, &clip_id, None)?;
    if let Some(previous) = previous {
        if repo::media::get(&tx, &previous)?.is_some() {
            repo::media::delete(&tx, &previous)?;
        }
    }
    tx.commit()?;
    repo::productions::clip(&conn, &clip_id)
}
