//! Integration FFmpeg : detection de l'executable, analyse (ffprobe),
//! miniatures et assemblage final.

pub mod install;
pub mod probe;
pub mod render;

#[cfg(test)]
mod integration_tests;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::util::path_to_string;

/// Cree une commande sans fenetre console (important sous Windows : l'application
/// est un programme graphique et chaque appel a ffmpeg ouvrirait sinon une console).
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub found: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    /// custom | managed | bundled | path | winget | scoop | chocolatey | common
    pub source: Option<String>,
    pub h264_encoder: Option<String>,
    pub has_aac: bool,
    pub searched: Vec<String>,
    pub error: Option<String>,
    /// Dossier de la copie installee par Fruity Studio.
    pub managed_dir: Option<String>,
    /// Vrai si une copie installee par Fruity Studio est presente.
    pub managed_installed: bool,
    /// L'installation automatique est-elle possible sur ce systeme ?
    pub can_auto_install: bool,
    /// Resultat de chaque executable essaye (ecrit dans le rapport de detection).
    #[serde(skip)]
    pub attempts: Vec<String>,
}

impl FfmpegInfo {
    pub fn require(&self) -> AppResult<(PathBuf, PathBuf)> {
        match (&self.ffmpeg_path, &self.ffprobe_path) {
            (Some(f), Some(p)) if self.found => Ok((PathBuf::from(f), PathBuf::from(p))),
            _ => Err(AppError::Ffmpeg(
                "FFmpeg est introuvable. Installez-le en un clic dans Paramètres › Vidéo & rendu \
                 (bouton « Installer FFmpeg automatiquement »)."
                    .into(),
            )),
        }
    }

    pub fn paths_exist(&self) -> bool {
        matches!((&self.ffmpeg_path, &self.ffprobe_path), (Some(f), Some(p)) if Path::new(f).is_file() && Path::new(p).is_file())
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn find_in_tree(root: &Path, file: &str, depth: usize) -> Option<PathBuf> {
    let direct = root.join(file);
    if direct.is_file() {
        return Some(direct);
    }
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_in_tree(&p, file, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn candidates(custom: Option<&str>, managed: Option<&Path>) -> Vec<(PathBuf, &'static str)> {
    let ffmpeg = exe("ffmpeg");
    let mut out: Vec<(PathBuf, &'static str)> = Vec::new();

    if let Some(custom) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(custom);
        if p.is_dir() {
            out.push((p.join(&ffmpeg), "custom"));
            out.push((p.join("bin").join(&ffmpeg), "custom"));
        } else {
            out.push((p, "custom"));
        }
    }
    // Copie installee par Fruity Studio (bouton « Installer FFmpeg »).
    if let Some(dir) = managed {
        out.push((dir.join(&ffmpeg), "managed"));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        out.push((dir.join(&ffmpeg), "bundled"));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            out.push((dir.join(&ffmpeg), "path"));
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            out.push((local.join(r"Microsoft\WinGet\Links").join(&ffmpeg), "winget"));
            let packages = local.join(r"Microsoft\WinGet\Packages");
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.contains("ffmpeg") {
                        if let Some(found) = find_in_tree(&entry.path(), &ffmpeg, 3) {
                            out.push((found, "winget"));
                        }
                    }
                }
            }
        }
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            out.push((home.join(r"scoop\shims").join(&ffmpeg), "scoop"));
            out.push((home.join(r"scoop\apps\ffmpeg\current\bin").join(&ffmpeg), "scoop"));
        }
        out.push((PathBuf::from(r"C:\ProgramData\chocolatey\bin").join(&ffmpeg), "chocolatey"));
        for base in [r"C:\ffmpeg\bin", r"C:\Program Files\ffmpeg\bin", r"C:\Program Files (x86)\ffmpeg\bin"] {
            out.push((PathBuf::from(base).join(&ffmpeg), "common"));
        }
    }

    let mut seen = HashSet::new();
    out.retain(|(p, _)| seen.insert(path_to_string(p).to_lowercase()));
    out
}

/// Version de ffmpeg, ou la raison exacte de l'echec.
fn read_version(ffmpeg: &Path) -> Result<String, String> {
    let output = command(ffmpeg).arg("-version").output().map_err(|e| format!("lancement impossible : {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("arrêt anormal, {} {}", output.status, stderr.lines().next().unwrap_or("")).trim_end().to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()
        .and_then(|line| line.strip_prefix("ffmpeg version "))
        .and_then(|rest| rest.split_whitespace().next())
        .map(str::to_string)
        .ok_or_else(|| "réponse inattendue à -version".to_string())
}

/// Un antivirus peut bloquer brievement un gros executable juste apres un demarrage.
fn read_version_with_retry(ffmpeg: &Path, attempts: u64) -> Result<String, String> {
    let mut outcome = read_version(ffmpeg);
    for attempt in 1..attempts {
        if outcome.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(400 * attempt));
        outcome = read_version(ffmpeg);
    }
    outcome
}

fn read_encoders(ffmpeg: &Path) -> (Option<String>, bool) {
    let Ok(output) = command(ffmpeg).args(["-hide_banner", "-encoders"]).output() else {
        return (None, false);
    };
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let has = |name: &str| text.lines().any(|l| l.split_whitespace().nth(1) == Some(name));
    let h264 = ["libx264", "h264_mf", "h264_nvenc", "h264_qsv", "h264_amf"]
        .into_iter()
        .find(|e| has(e))
        .map(str::to_string);
    (h264, has("aac"))
}

/// Recherche FFmpeg : chemin personnalise, copie installee par Fruity Studio,
/// dossier de l'application, PATH, WinGet, Scoop, Chocolatey et emplacements courants.
pub fn detect(custom: Option<&str>, managed: Option<&Path>) -> FfmpegInfo {
    let ffprobe = exe("ffprobe");
    let mut info = FfmpegInfo {
        managed_dir: managed.map(path_to_string),
        managed_installed: managed.is_some_and(|d| d.join(exe("ffmpeg")).is_file() && d.join(&ffprobe).is_file()),
        can_auto_install: cfg!(windows) && managed.is_some(),
        ..Default::default()
    };
    for (candidate, source) in candidates(custom, managed) {
        info.searched.push(path_to_string(&candidate));
        if !candidate.is_file() {
            continue;
        }
        let version = match read_version_with_retry(&candidate, if source == "managed" { 3 } else { 1 }) {
            Ok(version) => version,
            Err(reason) => {
                info.attempts.push(format!("{} : {reason}", path_to_string(&candidate)));
                if source == "managed" {
                    info.error = Some(format!("FFmpeg est bien installé mais ne démarre pas ({reason})."));
                }
                continue;
            }
        };
        info.attempts.push(format!("{} : version {version}", path_to_string(&candidate)));
        let probe = candidate.with_file_name(&ffprobe);
        if !probe.is_file() {
            info.error = Some(format!(
                "ffmpeg trouvé ({}) mais ffprobe est absent du même dossier.",
                path_to_string(&candidate)
            ));
            continue;
        }
        let (h264, aac) = read_encoders(&candidate);
        info.found = true;
        info.ffmpeg_path = Some(path_to_string(&candidate));
        info.ffprobe_path = Some(path_to_string(&probe));
        info.version = Some(version);
        info.source = Some(source.to_string());
        info.h264_encoder = h264;
        info.has_aac = aac;
        info.error = if info.h264_encoder.is_none() {
            Some("Cette version de FFmpeg ne propose aucun encodeur H.264.".into())
        } else if !aac {
            Some("Cette version de FFmpeg ne propose pas l'encodeur AAC.".into())
        } else {
            None
        };
        return info;
    }
    if custom.map(str::trim).is_some_and(|c| !c.is_empty()) && info.error.is_none() {
        info.error = Some("Le chemin FFmpeg indiqué n'est pas un exécutable valide.".into());
    }
    info
}

/// Extrait une image JPEG de la video (miniature).
pub fn extract_thumbnail(ffmpeg: &Path, input: &Path, output: &Path, at_seconds: f64) -> AppResult<()> {
    let at = format!("{:.3}", at_seconds.max(0.0));
    let result = command(ffmpeg)
        .args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &at, "-i"])
        .arg(input)
        .args(["-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3"])
        .arg(output)
        .output()?;
    if !result.status.success() || !output.is_file() {
        return Err(AppError::Ffmpeg(format!(
            "Impossible de créer la miniature : {}",
            String::from_utf8_lossy(&result.stderr).trim()
        )));
    }
    Ok(())
}
