//! Installation automatique de FFmpeg (Windows).
//!
//! Source : build « essentials » de gyan.dev (builds Windows references par
//! ffmpeg.org, inclut libx264 et AAC). L'archive vient en priorite du miroir
//! GitHub de Gyan (bien plus rapide, celui qu'utilise WinGet), avec repli sur
//! gyan.dev ; son SHA-256 est compare a l'empreinte publiee par gyan.dev avant
//! extraction. Seuls ffmpeg.exe / ffprobe.exe (+ licence) sont extraits dans le
//! dossier de l'application : aucun droit administrateur, aucune modification
//! du PATH ni du registre. Desinstallation = suppression du dossier.

use std::fs::File;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub const DOWNLOAD_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
pub const CHECKSUM_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
pub const VERSION_URL: &str = "https://www.gyan.dev/ffmpeg/builds/release-version";

/// Miroir GitHub de la meme archive pour une version donnee.
pub fn mirror_url(version: &str) -> String {
    format!("https://github.com/GyanD/codexffmpeg/releases/download/{version}/ffmpeg-{version}-essentials_build.zip")
}

/// Numero de version publie (chiffres et points uniquement : il entre dans une URL).
pub fn parse_version(text: &str) -> Option<String> {
    let version = text.trim();
    let valid = !version.is_empty()
        && version.len() <= 20
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version.chars().all(|c| c.is_ascii_digit() || c == '.');
    valid.then(|| version.to_string())
}

/// Dossier ou Fruity Studio installe sa propre copie de FFmpeg.
pub fn managed_dir(tools_root: &Path) -> PathBuf {
    tools_root.join("ffmpeg")
}

#[cfg(test)]
pub fn managed_installed(tools_root: &Path) -> bool {
    let dir = managed_dir(tools_root);
    dir.join("ffmpeg.exe").is_file() && dir.join("ffprobe.exe").is_file()
}

/// Extrait l'empreinte SHA-256 (64 caracteres hexadecimaux) d'un fichier de somme de controle.
pub fn parse_checksum(text: &str) -> Option<String> {
    text.split(|c: char| !c.is_ascii_hexdigit())
        .find(|token| token.len() == 64)
        .map(|token| token.to_ascii_lowercase())
}

pub fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("FruityStudio/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(30))
        // Pas de delai global (gros fichier) mais detection des connexions bloquees.
        .read_timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| AppError::Other(format!("Client HTTP indisponible : {e}")))
}

fn network_error(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::Network("Le téléchargement est bloqué (délai dépassé). Vérifiez votre connexion puis réessayez.".into())
    } else if e.is_connect() {
        AppError::Network("Impossible de joindre le serveur de téléchargement de FFmpeg. Vérifiez votre connexion Internet.".into())
    } else if let Some(status) = e.status() {
        AppError::Network(format!("Le serveur de téléchargement a répondu {status}. Réessayez plus tard."))
    } else {
        AppError::Network("Erreur réseau pendant le téléchargement de FFmpeg.".into())
    }
}

pub async fn fetch_checksum(client: &reqwest::Client) -> AppResult<String> {
    let text = client
        .get(CHECKSUM_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(network_error)?
        .text()
        .await
        .map_err(network_error)?;
    parse_checksum(&text).ok_or_else(|| {
        AppError::Network("La somme de contrôle de FFmpeg est illisible : installation annulée par sécurité.".into())
    })
}

/// Version de la derniere release ; `None` si elle est indisponible (on passe alors par gyan.dev).
pub async fn fetch_version(client: &reqwest::Client) -> Option<String> {
    let response = client.get(VERSION_URL).send().await.ok()?.error_for_status().ok()?;
    parse_version(&response.text().await.ok()?)
}

/// Sources de telechargement, par ordre de preference.
pub fn download_sources(version: Option<&str>) -> Vec<String> {
    version
        .map(mirror_url)
        .into_iter()
        .chain(std::iter::once(DOWNLOAD_URL.to_string()))
        .collect()
}

/// Telecharge l'archive dans `dest` en calculant son SHA-256 au fil de l'eau.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(network_error)?;
    let total = response.content_length();
    let mut file = File::create(dest)?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    on_progress(0, total);
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled("Installation de FFmpeg annulée.".into()));
        }
        file.write_all(&chunk)?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }
    file.flush()?;
    if let Some(expected) = total {
        if downloaded != expected {
            return Err(AppError::Network("Téléchargement incomplet. Réessayez.".into()));
        }
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Extrait ffmpeg.exe, ffprobe.exe et la licence dans `dest`. Les noms de sortie
/// sont fixes : le contenu de l'archive ne peut pas ecrire ailleurs (zip-slip).
pub fn extract_binaries(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let invalid = |e: zip::result::ZipError| AppError::Other(format!("Archive FFmpeg illisible : {e}"));
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip_path)?)).map_err(invalid)?;
    std::fs::create_dir_all(dest)?;
    let mut found_ffmpeg = false;
    let mut found_ffprobe = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(invalid)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(invalid)?.replace('\\', "/").to_ascii_lowercase();
        let target = if name.ends_with("/bin/ffmpeg.exe") || name == "bin/ffmpeg.exe" {
            found_ffmpeg = true;
            "ffmpeg.exe"
        } else if name.ends_with("/bin/ffprobe.exe") || name == "bin/ffprobe.exe" {
            found_ffprobe = true;
            "ffprobe.exe"
        } else if name.ends_with("/license") || name.ends_with("/license.txt") || name == "license" {
            "LICENSE.txt"
        } else {
            continue;
        };
        let mut out = File::create(dest.join(target))?;
        std::io::copy(&mut entry, &mut out)?;
        out.flush()?;
    }
    if !found_ffmpeg || !found_ffprobe {
        return Err(AppError::Other(
            "L'archive téléchargée ne contient pas ffmpeg.exe et ffprobe.exe.".into(),
        ));
    }
    Ok(())
}

/// Renomme avec quelques essais : sous Windows, un antivirus peut verrouiller
/// brievement un executable qui vient d'etre extrait.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..8 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(Duration::from_millis(250 * (attempt + 1)));
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("renommage impossible")))
}

/// Copie les fichiers d'un dossier (repli si le renommage reste bloque).
fn copy_dir_files(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        if entry.path().is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Remplace le dossier gere par le contenu fraichement extrait, en restaurant
/// l'installation precedente en cas d'echec.
pub fn swap_into_place(staged_bin: &Path, tools_root: &Path, unique: &str) -> AppResult<PathBuf> {
    let target = managed_dir(tools_root);
    let backup = tools_root.join(format!("ffmpeg-ancien-{unique}"));
    if target.exists() {
        rename_with_retry(&target, &backup).map_err(|e| {
            AppError::Other(format!(
                "Impossible de remplacer l'installation existante (FFmpeg est peut-être en cours d'utilisation) : {e}"
            ))
        })?;
    }
    if rename_with_retry(staged_bin, &target).is_err() {
        if let Err(e) = copy_dir_files(staged_bin, &target) {
            let _ = std::fs::remove_dir_all(&target);
            if backup.exists() {
                let _ = std::fs::rename(&backup, &target);
            }
            return Err(AppError::Other(format!(
                "Installation impossible (fichier bloqué, antivirus ?) : {e}"
            )));
        }
    }
    if backup.exists() {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn parses_checksum_files() {
        let hash = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
        assert_eq!(parse_checksum(hash).as_deref(), Some(hash));
        assert_eq!(parse_checksum(&format!("{}  ffmpeg.zip\n", hash.to_uppercase())).as_deref(), Some(hash));
        assert_eq!(parse_checksum("<html>not found</html>"), None);
    }

    #[test]
    fn version_is_strictly_validated_before_building_urls() {
        assert_eq!(parse_version(" 9.0.2\n").as_deref(), Some("9.0.2"));
        assert_eq!(parse_version("<html>"), None);
        assert_eq!(parse_version("../../evil"), None);
        assert_eq!(parse_version(""), None);
        assert_eq!(
            mirror_url("9.0.2"),
            "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip"
        );
    }

    #[test]
    fn mirror_comes_first_with_official_fallback() {
        assert_eq!(download_sources(Some("9.0.2")), vec![mirror_url("9.0.2"), DOWNLOAD_URL.to_string()]);
        assert_eq!(download_sources(None), vec![DOWNLOAD_URL.to_string()]);
    }

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut writer = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, content) in entries {
            writer.start_file(*name, SimpleFileOptions::default()).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn extracts_only_needed_binaries_with_fixed_names() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("ffmpeg.zip");
        make_zip(
            &zip_path,
            &[
                ("ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe", b"ffmpeg"),
                ("ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe", b"ffprobe"),
                ("ffmpeg-9.0.2-essentials_build/bin/ffplay.exe", b"ffplay"),
                ("ffmpeg-9.0.2-essentials_build/LICENSE", b"GPL"),
                ("ffmpeg-9.0.2-essentials_build/doc/ffmpeg.html", b"doc"),
                ("../../evil/bin/ffmpeg.exe.txt", b"x"),
            ],
        );
        let out = dir.path().join("out");
        extract_binaries(&zip_path, &out).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(&out)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["LICENSE.txt", "ffmpeg.exe", "ffprobe.exe"]);
        assert_eq!(std::fs::read(out.join("ffprobe.exe")).unwrap(), b"ffprobe");
        assert!(!dir.path().join("evil").exists());
    }

    #[test]
    fn rejects_archive_without_binaries() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("bad.zip");
        make_zip(&zip_path, &[("readme.txt", b"hello")]);
        assert!(extract_binaries(&zip_path, &dir.path().join("out")).is_err());
    }

    /// Test reseau reel, active par `FRUITY_TEST_FFMPEG_DOWNLOAD=1` : telecharge
    /// l'archive officielle, verifie sa somme et l'extrait. Les binaires ne sont
    /// jamais executes.
    #[test]
    fn real_download_is_verified_and_extracted() {
        if std::env::var_os("FRUITY_TEST_FFMPEG_DOWNLOAD").is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("ffmpeg.zip");
        let cancel = AtomicBool::new(false);
        let (expected, actual, seen) = tauri::async_runtime::block_on(async {
            let client = http_client().unwrap();
            let expected = fetch_checksum(&client).await.unwrap();
            let version = fetch_version(&client).await.expect("version publiee");
            let mut seen = 0u64;
            let actual = download(&client, &mirror_url(&version), &zip_path, &cancel, |d, _| seen = d).await.unwrap();
            (expected, actual, seen)
        });
        assert_eq!(expected, actual, "somme de controle");
        assert!(seen > 50_000_000, "taille telechargee : {seen}");

        let out = dir.path().join("bin");
        extract_binaries(&zip_path, &out).unwrap();
        for exe in ["ffmpeg.exe", "ffprobe.exe"] {
            let bytes = std::fs::read(out.join(exe)).unwrap();
            assert!(bytes.len() > 10_000_000, "{exe} : {} octets", bytes.len());
            assert_eq!(&bytes[..2], b"MZ", "{exe} est un executable Windows");
        }
        assert!(!out.join("ffplay.exe").exists());
        assert!(out.join("LICENSE.txt").exists());
    }

    #[test]
    fn swap_replaces_previous_install() {
        let dir = tempfile::tempdir().unwrap();
        let tools = dir.path();
        std::fs::create_dir_all(managed_dir(tools)).unwrap();
        std::fs::write(managed_dir(tools).join("ffmpeg.exe"), b"old").unwrap();
        let staged = tools.join("staging").join("bin");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("ffmpeg.exe"), b"new").unwrap();
        std::fs::write(staged.join("ffprobe.exe"), b"new").unwrap();
        let target = swap_into_place(&staged, tools, "x").unwrap();
        assert_eq!(std::fs::read(target.join("ffmpeg.exe")).unwrap(), b"new");
        assert!(managed_installed(tools));
        assert!(!tools.join("ffmpeg-ancien-x").exists());
    }
}
