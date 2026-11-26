//! Installation de FFmpeg en un clic, desinstallation et autotest d'encodage.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::install::{self, managed_dir};
use crate::ffmpeg::probe::probe;
use crate::ffmpeg::render::encoder_args;
use crate::ffmpeg::{FfmpegInfo, command};
use crate::state::AppState;
use crate::util::{new_id, path_to_string};

pub const INSTALL_EVENT: &str = "ffmpeg-install-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// checking | downloading | verifying | extracting | testing | done | error | cancelled
    pub stage: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: f64,
    pub message: String,
}

fn emit(app: &AppHandle, stage: &str, downloaded: u64, total: Option<u64>, percent: f64, message: impl Into<String>) {
    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress {
            stage: stage.into(),
            downloaded,
            total,
            percent: (percent * 10.0).round() / 10.0,
            message: message.into(),
        },
    );
}

fn reset_cache(state: &AppState) {
    if let Ok(mut cache) = state.ffmpeg.lock() {
        *cache = None;
    }
}

fn render_running(state: &AppState) -> bool {
    state.render_job.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// Telecharge, verifie (SHA-256) et installe FFmpeg dans le dossier de l'application.
#[tauri::command]
pub async fn ffmpeg_install(app: AppHandle) -> AppResult<FfmpegInfo> {
    if !cfg!(windows) {
        return Err(AppError::validation("L'installation automatique de FFmpeg est disponible uniquement sous Windows."));
    }
    let cancel = {
        let state = app.state::<AppState>();
        if render_running(&state) {
            return Err(AppError::validation("Un rendu est en cours : attendez sa fin avant d'installer FFmpeg."));
        }
        let mut guard = state.ffmpeg_install.lock().map_err(|_| AppError::Other("Verrou corrompu".into()))?;
        if guard.is_some() {
            return Err(AppError::validation("L'installation de FFmpeg est déjà en cours."));
        }
        let flag = Arc::new(AtomicBool::new(false));
        *guard = Some(flag.clone());
        flag
    };

    let result = run_install(&app, &cancel).await;

    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.ffmpeg_install.lock() {
        *guard = None;
    }
    match &result {
        Ok(info) => emit(
            &app,
            "done",
            0,
            None,
            100.0,
            format!("FFmpeg {} installé et vérifié.", info.version.clone().unwrap_or_default()),
        ),
        Err(AppError::Cancelled(msg)) => emit(&app, "cancelled", 0, None, 0.0, msg.clone()),
        Err(e) => emit(&app, "error", 0, None, 0.0, e.to_string()),
    }
    result
}

async fn run_install(app: &AppHandle, cancel: &Arc<AtomicBool>) -> AppResult<FfmpegInfo> {
    let tools_dir = app.state::<AppState>().tools_dir.clone();
    std::fs::create_dir_all(&tools_dir)?;
    let unique = new_id();
    let staging = tools_dir.join(format!("ffmpeg-installation-{unique}"));
    std::fs::create_dir_all(&staging)?;
    let outcome = install_into(app, cancel, &tools_dir, &staging, &unique).await;
    let _ = std::fs::remove_dir_all(&staging);
    outcome
}

async fn install_into(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    tools_dir: &std::path::Path,
    staging: &std::path::Path,
    unique: &str,
) -> AppResult<FfmpegInfo> {
    emit(app, "checking", 0, None, 0.0, "Connexion à la source officielle des builds Windows…");
    let client = install::http_client()?;
    let expected = install::fetch_checksum(&client).await?;
    let version = install::fetch_version(&client).await;

    // Miroir GitHub d'abord (rapide), puis gyan.dev. La somme de controle vient
    // toujours de gyan.dev : une archive differente est refusee quelle que soit sa source.
    let zip_path = staging.join("ffmpeg.zip");
    let mut verified = false;
    let mut last_error = None;
    for url in install::download_sources(version.as_deref()) {
        let mut last = Instant::now();
        let app_for_progress = app.clone();
        let outcome = install::download(&client, &url, &zip_path, cancel, |downloaded, total| {
            if last.elapsed().as_millis() < 150 && total.is_some_and(|t| downloaded < t) {
                return;
            }
            last = Instant::now();
            let percent = total.map(|t| downloaded as f64 / t.max(1) as f64 * 100.0).unwrap_or(0.0);
            emit(&app_for_progress, "downloading", downloaded, total, percent, "Téléchargement de FFmpeg…");
        })
        .await;
        match outcome {
            Ok(actual) => {
                emit(app, "verifying", 0, None, 100.0, "Vérification de l'intégrité (SHA-256)…");
                if actual == expected {
                    verified = true;
                    break;
                }
                last_error = Some(AppError::Network(
                    "Le fichier téléchargé ne correspond pas à la somme de contrôle officielle : installation annulée. Réessayez.".into(),
                ));
            }
            Err(AppError::Cancelled(msg)) => return Err(AppError::Cancelled(msg)),
            Err(e) => last_error = Some(e),
        }
    }
    if !verified {
        return Err(last_error.unwrap_or_else(|| AppError::Network("Téléchargement de FFmpeg impossible.".into())));
    }
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled("Installation de FFmpeg annulée.".into()));
    }

    emit(app, "extracting", 0, None, 100.0, "Extraction de ffmpeg.exe et ffprobe.exe…");
    let staged_bin = staging.join("bin");
    {
        let zip_path = zip_path.clone();
        let staged_bin = staged_bin.clone();
        blocking(move || install::extract_binaries(&zip_path, &staged_bin)).await?;
    }
    let _ = std::fs::remove_file(&zip_path);

    emit(app, "testing", 0, None, 100.0, "Test de l'exécutable et des encodeurs H.264 / AAC…");
    let staged_check = staged_bin.clone();
    let check = blocking(move || Ok(crate::ffmpeg::detect(Some(&path_to_string(&staged_check)), None))).await?;
    if !check.found {
        return Err(AppError::Ffmpeg(
            "FFmpeg téléchargé ne démarre pas sur ce système (antivirus ou fichier bloqué ?).".into(),
        ));
    }
    if check.h264_encoder.is_none() || !check.has_aac {
        return Err(AppError::Ffmpeg("Le FFmpeg téléchargé ne propose pas les encodeurs H.264 et AAC.".into()));
    }

    let state = app.state::<AppState>();
    if render_running(&state) {
        return Err(AppError::validation("Un rendu a démarré pendant l'installation : réessayez après le rendu."));
    }
    {
        let (staged_bin, tools_dir, unique) = (staged_bin.clone(), tools_dir.to_path_buf(), unique.to_string());
        blocking(move || install::swap_into_place(&staged_bin, &tools_dir, &unique)).await?;
    }
    reset_cache(&state);
    let info = state.ffmpeg_info(true)?;
    if !info.found {
        return Err(AppError::Ffmpeg("FFmpeg a été installé mais n'est pas détecté. Relancez la détection.".into()));
    }
    Ok(info)
}

#[tauri::command]
pub async fn ffmpeg_install_cancel(state: State<'_, AppState>) -> AppResult<bool> {
    let guard = state.ffmpeg_install.lock().map_err(|_| AppError::Other("Verrou corrompu".into()))?;
    match guard.as_ref() {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn ffmpeg_install_status(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.ffmpeg_install.lock().map(|g| g.is_some()).unwrap_or(false))
}

/// Supprime la copie de FFmpeg installee par Fruity Studio.
#[tauri::command]
pub async fn ffmpeg_uninstall(app: AppHandle) -> AppResult<FfmpegInfo> {
    blocking(move || {
        let state = app.state::<AppState>();
        if render_running(&state) {
            return Err(AppError::validation("Un rendu est en cours : attendez sa fin."));
        }
        if state.ffmpeg_install.lock().map(|g| g.is_some()).unwrap_or(false) {
            return Err(AppError::validation("Une installation est en cours."));
        }
        let dir = managed_dir(&state.tools_dir);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| {
                AppError::Other(format!("Suppression impossible (FFmpeg est peut-être en cours d'utilisation) : {e}"))
            })?;
        }
        reset_cache(&state);
        state.ffmpeg_info(true)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfTestResult {
    pub encoder: String,
    pub elapsed_ms: u128,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: i64,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
}

/// Encode une courte video de test (mire + son, 1080x1920, 30 i/s) avec les
/// memes reglages que le rendu final, puis l'analyse avec ffprobe.
#[tauri::command]
pub async fn ffmpeg_self_test(app: AppHandle) -> AppResult<SelfTestResult> {
    blocking(move || {
        let state = app.state::<AppState>();
        let info = state.ffmpeg_info(false)?;
        let (ffmpeg, ffprobe) = info.require()?;
        let encoder = info
            .h264_encoder
            .clone()
            .ok_or_else(|| AppError::Ffmpeg("Aucun encodeur H.264 disponible.".into()))?;
        let out = state.workspace()?.tmp_dir()?.join(format!("autotest-{}.mp4", new_id()));
        let started = Instant::now();
        let mut args: Vec<String> = [
            "-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
            "testsrc2=size=1080x1920:rate=30:duration=2", "-f", "lavfi", "-i",
            "sine=frequency=660:sample_rate=48000:duration=2", "-map", "0:v", "-map", "1:a",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        args.extend(encoder_args(&encoder, 30));
        args.extend(["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-shortest", "-movflags", "+faststart", "-f", "mp4"].map(String::from));
        args.push(path_to_string(&out));
        let output = command(&ffmpeg).args(&args).output()?;
        let elapsed_ms = started.elapsed().as_millis();
        if !output.status.success() || !out.is_file() {
            let _ = std::fs::remove_file(&out);
            return Err(AppError::Ffmpeg(format!(
                "L'encodage de test a échoué : {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let result = probe(&ffprobe, &out);
        let _ = std::fs::remove_file(&out);
        let info = result?;
        if info.video_codec.as_deref() != Some("h264") || info.audio_codec.as_deref() != Some("aac") {
            return Err(AppError::Ffmpeg("La vidéo de test n'est pas en H.264 + AAC.".into()));
        }
        Ok(SelfTestResult {
            encoder,
            elapsed_ms,
            width: info.width,
            height: info.height,
            duration_ms: (info.duration * 1000.0).round() as i64,
            video_codec: info.video_codec,
            audio_codec: info.audio_codec,
        })
    })
    .await
}
