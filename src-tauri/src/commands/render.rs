use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::probe::{self, ProbeInfo};
use crate::ffmpeg::render::{self, JobHandle, RenderInput, RenderOptions, Strategy};
use crate::ffmpeg::extract_thumbnail;
use crate::models::{MediaAsset, ProductionUpdateInput};
use crate::repo::{self, media::NewAsset};
use crate::state::{AppState, RenderJob};
use crate::util::{new_id, now, path_to_string, sanitize_file_name, unique_path};

pub const PROGRESS_EVENT: &str = "render-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgress {
    pub production_id: String,
    /// preparing | probing | encoding | finalizing | done | error | cancelled
    pub stage: String,
    pub percent: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub asset: MediaAsset,
    pub output_path: String,
    pub duration_ms: i64,
    pub size_bytes: i64,
    pub strategy: Strategy,
    pub warnings: Vec<String>,
    pub log_path: Option<String>,
}

fn emit(app: &AppHandle, production_id: &str, stage: &str, percent: f64, message: impl Into<String>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        RenderProgress {
            production_id: production_id.to_string(),
            stage: stage.to_string(),
            percent: (percent * 10.0).round() / 10.0,
            message: message.into(),
        },
    );
}

#[tauri::command]
pub async fn production_render(app: AppHandle, production_id: String, options: RenderOptions) -> AppResult<RenderResult> {
    options.validate()?;
    let handle = {
        let state = app.state::<AppState>();
        let mut guard = state
            .render_job
            .lock()
            .map_err(|_| AppError::Other("Verrou du rendu corrompu".into()))?;
        if guard.is_some() {
            return Err(AppError::validation("Un rendu est déjà en cours. Attendez sa fin ou annulez-le."));
        }
        let handle = JobHandle::default();
        *guard = Some(RenderJob { production_id: production_id.clone(), handle: handle.clone() });
        handle
    };

    let app_for_job = app.clone();
    let id_for_job = production_id.clone();
    let result = blocking(move || render_blocking(&app_for_job, &id_for_job, &options, &handle)).await;

    if let Ok(mut guard) = app.state::<AppState>().render_job.lock() {
        *guard = None;
    }
    match &result {
        Ok(r) => emit(&app, &production_id, "done", 100.0, format!("Rendu terminé : {}", r.output_path)),
        Err(AppError::Cancelled(msg)) => emit(&app, &production_id, "cancelled", 0.0, msg.clone()),
        Err(e) => emit(&app, &production_id, "error", 0.0, e.to_string()),
    }
    result
}

#[tauri::command]
pub async fn render_cancel(state: State<'_, AppState>) -> AppResult<bool> {
    let guard = state.render_job.lock().map_err(|_| AppError::Other("Verrou du rendu corrompu".into()))?;
    match guard.as_ref() {
        Some(job) => {
            job.handle.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn render_status(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let guard = state.render_job.lock().map_err(|_| AppError::Other("Verrou du rendu corrompu".into()))?;
    Ok(guard.as_ref().map(|job| job.production_id.clone()))
}

struct TempFiles(Vec<PathBuf>);
impl Drop for TempFiles {
    fn drop(&mut self) {
        for p in &self.0 {
            if p.exists() {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

fn render_blocking(app: &AppHandle, production_id: &str, opts: &RenderOptions, job: &JobHandle) -> AppResult<RenderResult> {
    let state = app.state::<AppState>();
    emit(app, production_id, "preparing", 0.0, "Vérification des clips…");

    let detail = repo::productions::detail(&*state.conn()?, production_id)?;
    if detail.clips.is_empty() {
        return Err(AppError::validation("Cette production ne contient aucun clip."));
    }
    // Ordre garanti par le numero de clip (jamais par l'ordre d'import).
    let mut clips = detail.clips.clone();
    clips.sort_by_key(|c| c.clip_number);
    let missing: Vec<String> = clips
        .iter()
        .filter(|c| c.video.as_ref().is_none_or(|v| !v.file_exists))
        .map(|c| c.clip_number.to_string())
        .collect();
    if !missing.is_empty() {
        return Err(AppError::validation(format!(
            "Vidéos manquantes pour le(s) clip(s) {}. Importez-les avant de lancer le rendu.",
            missing.join(", ")
        )));
    }

    let mut info = state.ffmpeg_info(false)?;
    if !info.found {
        info = state.ffmpeg_info(true)?;
    }
    let (ffmpeg, ffprobe) = info.require()?;
    let encoder = info
        .h264_encoder
        .clone()
        .ok_or_else(|| AppError::Ffmpeg("Aucun encodeur H.264 disponible dans cette version de FFmpeg.".into()))?;

    let music_path = match opts.music_asset_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let asset = repo::media::require(&*state.conn()?, id)?;
            if asset.kind != "music" && asset.kind != "sfx" {
                return Err(AppError::validation("Le média choisi comme musique de fond n'est pas un fichier audio."));
            }
            if !asset.file_exists {
                return Err(AppError::not_found(format!("Fichier musical introuvable : {}", asset.file_path)));
            }
            Some(PathBuf::from(asset.file_path))
        }
        None => None,
    };

    let mut inputs = Vec::with_capacity(clips.len());
    for (index, clip) in clips.iter().enumerate() {
        if job.is_cancelled() {
            return Err(AppError::Cancelled("Rendu annulé.".into()));
        }
        emit(app, production_id, "probing", (index as f64 / clips.len() as f64) * 4.0, format!("Analyse du clip {}…", clip.clip_number));
        let video = clip.video.as_ref().expect("verifie plus haut");
        let path = PathBuf::from(&video.file_path);
        let probe = probe::probe(&ffprobe, &path)?;
        if !probe.has_video || probe.duration <= 0.0 {
            return Err(AppError::validation(format!("La vidéo du clip {} est illisible ou vide.", clip.clip_number)));
        }
        inputs.push(RenderInput { path, probe });
    }

    // Sauvegarde des reglages pour le prochain rendu.
    let _ = repo::productions::update(
        &*state.conn()?,
        production_id,
        &ProductionUpdateInput { render_settings: Some(serde_json::to_value(opts)?), ..Default::default() },
    );

    let out_dir = match opts.output_dir.trim() {
        "" => PathBuf::from(state.settings()?.export_dir),
        dir => PathBuf::from(dir),
    };
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| AppError::validation(format!("Dossier de sortie inaccessible ({}) : {e}", out_dir.display())))?;
    let stem = sanitize_file_name(
        if opts.file_name.trim().is_empty() { &detail.production.title } else { opts.file_name.trim().trim_end_matches(".mp4") },
        "Fruity Studio",
    );
    let ws = state.workspace()?;
    let temp_output = unique_path(&out_dir, &format!("{stem}.rendu-en-cours"), Some("mp4"));
    let concat_list = ws.tmp_dir()?.join(format!("concat-{}.txt", new_id()));
    let _cleanup = TempFiles(vec![temp_output.clone(), concat_list.clone()]);

    let started = Instant::now();
    let mut attempt_force = false;
    let (plan, stderr_log) = loop {
        let plan = render::plan(&inputs, music_path.as_deref(), opts, &encoder, &temp_output, &concat_list, attempt_force);
        if let Some(list) = &plan.concat_list {
            std::fs::write(&concat_list, list)?;
        }
        let total = plan.total_duration.max(0.1);
        let label = match plan.strategy {
            Strategy::Copy => "Assemblage sans réencodage vidéo…",
            Strategy::Reencode => "Normalisation et encodage H.264…",
        };
        emit(app, production_id, "encoding", 5.0, label);
        let mut last_emit = Instant::now();
        let outcome = render::run(&ffmpeg, &plan.args, job, |seconds| {
            if last_emit.elapsed().as_millis() >= 200 {
                last_emit = Instant::now();
                let pct = 5.0 + 90.0 * (seconds / total).clamp(0.0, 1.0);
                emit(app, production_id, "encoding", pct, label);
            }
        });
        match outcome {
            Ok(log) => break (plan, log),
            Err(AppError::Ffmpeg(msg)) if plan.strategy == Strategy::Copy && !attempt_force => {
                // La concatenation directe a echoue : normalisation complete.
                eprintln!("[render] echec du mode copie, reencodage : {msg}");
                attempt_force = true;
                let _ = std::fs::remove_file(&temp_output);
                continue;
            }
            Err(e) => return Err(e),
        }
    };

    emit(app, production_id, "finalizing", 96.0, "Vérification du fichier final…");
    let output_probe: ProbeInfo = probe::probe(&ffprobe, &temp_output)?;
    if !output_probe.has_video || output_probe.duration <= 0.0 {
        return Err(AppError::Ffmpeg("Le fichier rendu est invalide (aucune image).".into()));
    }
    let mut warnings = Vec::new();
    if !output_probe.has_audio {
        warnings.push("Le fichier final ne contient pas de piste audio.".to_string());
    }
    if (output_probe.duration - plan.total_duration).abs() > 1.0 {
        warnings.push(format!(
            "Durée finale {:.1} s (attendue {:.1} s).",
            output_probe.duration, plan.total_duration
        ));
    }

    let final_path = unique_path(&out_dir, &stem, Some("mp4"));
    std::fs::rename(&temp_output, &final_path)?;
    state.allow_directory(app, &out_dir);

    let thumbs = ws.thumbnails_dir()?;
    let thumb_path = thumbs.join(format!("{}.jpg", new_id()));
    let thumbnail = extract_thumbnail(&ffmpeg, &final_path, &thumb_path, (output_probe.duration / 3.0).min(2.0))
        .ok()
        .map(|_| path_to_string(&thumb_path));

    let log_path = ws.logs_dir().ok().map(|dir| dir.join(format!("rendu-{}-{}.log", production_id, now().replace([':', '.'], "-"))));
    if let Some(log) = &log_path {
        let content = format!(
            "Fruity Studio — journal de rendu\nProduction : {}\nStratégie : {:?}\nDurée : {:.1} s\nEncodeur : {encoder}\n\nArguments :\n{}\n\nSortie FFmpeg :\n{}",
            detail.production.title,
            plan.strategy,
            started.elapsed().as_secs_f64(),
            plan.args.join(" "),
            stderr_log
        );
        let _ = std::fs::write(log, content);
    }

    let size = std::fs::metadata(&final_path).map(|m| m.len() as i64).unwrap_or(0);
    let conn = state.conn()?;
    let tx = conn.unchecked_transaction()?;
    let asset = repo::media::insert(
        &tx,
        &NewAsset {
            kind: "render".into(),
            file_path: path_to_string(&final_path),
            original_name: final_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            mime_type: "video/mp4".into(),
            size_bytes: size,
            width: output_probe.width,
            height: output_probe.height,
            duration_ms: Some((output_probe.duration * 1000.0).round() as i64),
            fps: output_probe.fps,
            video_codec: output_probe.video_codec.clone(),
            audio_codec: output_probe.audio_codec.clone(),
            has_audio: Some(output_probe.has_audio),
            thumbnail_path: thumbnail.clone(),
            production_id: Some(production_id.to_string()),
            ..Default::default()
        },
    )?;
    if let Some(thumb) = &thumbnail {
        repo::media::insert(
            &tx,
            &NewAsset {
                kind: "thumbnail".into(),
                file_path: thumb.clone(),
                original_name: format!("Miniature — {}", detail.production.title),
                mime_type: "image/jpeg".into(),
                size_bytes: std::fs::metadata(thumb).map(|m| m.len() as i64).unwrap_or(0),
                parent_id: Some(asset.id.clone()),
                production_id: Some(production_id.to_string()),
                ..Default::default()
            },
        )?;
    }
    repo::productions::set_rendered(&tx, production_id, &asset.id, thumbnail.as_deref())?;
    tx.commit()?;

    Ok(RenderResult {
        output_path: asset.file_path.clone(),
        duration_ms: asset.duration_ms.unwrap_or(0),
        size_bytes: size,
        strategy: plan.strategy,
        warnings,
        log_path: log_path.filter(|p| Path::new(p).is_file()).map(|p| path_to_string(&p)),
        asset,
    })
}
