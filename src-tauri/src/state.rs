//! Etat global de l'application (base de donnees, client HTTP, cache FFmpeg...).

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::render::JobHandle;
use crate::ffmpeg::{self, FfmpegInfo};
use crate::media::Workspace;
use crate::secrets::KeyCache;
use crate::settings::{self, AppSettings};
use crate::util::path_to_string;

pub struct RenderJob {
    pub production_id: String,
    pub handle: JobHandle,
}

pub struct AppState {
    db: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    /// Outils installes par l'application (ex. `tools/ffmpeg`).
    pub tools_dir: PathBuf,
    pub http: reqwest::Client,
    pub keys: KeyCache,
    pub ffmpeg: Mutex<Option<FfmpegInfo>>,
    pub render_job: Mutex<Option<RenderJob>>,
    /// Drapeau d'annulation de l'installation de FFmpeg en cours.
    pub ffmpeg_install: Mutex<Option<Arc<AtomicBool>>>,
}

fn lock_err<T>(_: T) -> AppError {
    AppError::Other("Verrou interne corrompu, redémarrez l'application.".into())
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        // FRUITY_STUDIO_DATA_DIR permet d'isoler les donnees (tests, profil portable).
        let override_dir = std::env::var_os("FRUITY_STUDIO_DATA_DIR").map(PathBuf::from);
        let data_dir = match &override_dir {
            Some(dir) => dir.clone(),
            None => app.path().app_data_dir()?,
        };
        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("fruity-studio.db");
        let conn = db::open(&db_path)?;

        // Valeurs par defaut des dossiers au premier lancement.
        let mut current = settings::load(&conn)?;
        let mut changed = false;
        if current.workspace_dir.trim().is_empty() {
            let base = match &override_dir {
                Some(dir) => dir.clone(),
                None => app.path().app_local_data_dir()?,
            };
            current.workspace_dir = path_to_string(&base.join("workspace"));
            changed = true;
        }
        if current.export_dir.trim().is_empty() {
            let base = match &override_dir {
                Some(dir) => dir.join("exports"),
                None => app
                    .path()
                    .video_dir()
                    .or_else(|_| app.path().document_dir())
                    .map(|d| d.join("Fruity Studio"))?,
            };
            current.export_dir = path_to_string(&base);
            changed = true;
        }
        if changed {
            settings::save(&conn, &current)?;
        }
        std::fs::create_dir_all(&current.workspace_dir)?;
        let _ = std::fs::create_dir_all(&current.export_dir);

        let http = reqwest::Client::builder()
            .user_agent(concat!("FruityStudio/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(180))
            // Une connexion morte est detectee en quelques secondes au lieu de bloquer l'appel.
            .tcp_keepalive(Duration::from_secs(20))
            .pool_idle_timeout(Duration::from_secs(30))
            .http2_keep_alive_interval(Duration::from_secs(15))
            .http2_keep_alive_timeout(Duration::from_secs(10))
            .http2_keep_alive_while_idle(true)
            .build()
            .map_err(|e| AppError::Other(format!("Client HTTP indisponible : {e}")))?;

        let tools_dir = match &override_dir {
            Some(dir) => dir.join("tools"),
            None => app.path().app_local_data_dir()?.join("tools"),
        };

        let state = Self {
            db: Mutex::new(conn),
            data_dir,
            db_path,
            tools_dir,
            http,
            keys: KeyCache::default(),
            ffmpeg: Mutex::new(None),
            render_job: Mutex::new(None),
            ffmpeg_install: Mutex::new(None),
        };
        state.allow_media_scope(app)?;
        Ok(state)
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(lock_err)
    }

    pub fn settings(&self) -> AppResult<AppSettings> {
        settings::load(&*self.conn()?)
    }

    pub fn workspace(&self) -> AppResult<Workspace> {
        let s = self.settings()?;
        std::fs::create_dir_all(&s.workspace_dir)?;
        Ok(Workspace::new(s.workspace_dir))
    }

    /// Autorise le protocole `asset:` (affichage des images/videos locales) sur
    /// l'espace de travail, le dossier d'export et les dossiers des medias connus.
    pub fn allow_media_scope(&self, app: &AppHandle) -> AppResult<()> {
        let s = self.settings()?;
        let scope = app.asset_protocol_scope();
        for dir in [&s.workspace_dir, &s.export_dir] {
            let p = Path::new(dir);
            if p.is_dir() {
                let _ = scope.allow_directory(p, true);
            }
        }
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT file_path FROM media_assets UNION SELECT thumbnail_path FROM media_assets WHERE thumbnail_path IS NOT NULL")?;
        let paths: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let mut dirs = std::collections::HashSet::new();
        for p in paths {
            if let Some(parent) = Path::new(&p).parent() {
                if dirs.insert(parent.to_path_buf()) && parent.is_dir() {
                    let _ = scope.allow_directory(parent, false);
                }
            }
        }
        Ok(())
    }

    pub fn allow_directory(&self, app: &AppHandle, dir: &Path) {
        if dir.is_dir() {
            let _ = app.asset_protocol_scope().allow_directory(dir, false);
        }
    }

    /// Informations FFmpeg (detection mise en cache, relancee si les chemins disparaissent).
    pub fn ffmpeg_info(&self, force: bool) -> AppResult<FfmpegInfo> {
        let custom = self.settings()?.ffmpeg_path;
        let mut guard = self.ffmpeg.lock().map_err(lock_err)?;
        if !force {
            if let Some(info) = guard.as_ref() {
                if !info.found || info.paths_exist() {
                    return Ok(info.clone());
                }
            }
        }
        let managed = ffmpeg::install::managed_dir(&self.tools_dir);
        let info = ffmpeg::detect(custom.as_deref(), Some(&managed));
        self.write_detection_report(&managed, &info);
        *guard = Some(info.clone());
        Ok(info)
    }

    /// Garde la trace de la derniere detection : sans elle, un FFmpeg refuse sur une machine donnee reste inexplicable.
    fn write_detection_report(&self, managed: &Path, info: &FfmpegInfo) {
        let report = format!(
            "{}\r\ndossier géré : {} (copie présente : {})\r\ntrouvé : {} | source : {} | version : {} | erreur : {}\r\n{}\r\n",
            crate::util::now(),
            path_to_string(managed),
            info.managed_installed,
            info.found,
            info.source.as_deref().unwrap_or("-"),
            info.version.as_deref().unwrap_or("-"),
            info.error.as_deref().unwrap_or("-"),
            info.attempts.join("\r\n"),
        );
        let _ = std::fs::create_dir_all(&self.tools_dir);
        let _ = std::fs::write(self.tools_dir.join("derniere-detection.txt"), report);
    }

    pub fn ffmpeg_paths(&self) -> AppResult<Option<(PathBuf, PathBuf)>> {
        let info = self.ffmpeg_info(false)?;
        Ok(info.require().ok())
    }
}
