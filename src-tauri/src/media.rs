//! Espace de travail des medias : copie des fichiers importes (sans jamais
//! modifier les originaux), deduplication par SHA-256, types MIME.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::util::{extension_lower, new_id, path_to_string};

pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv"];
pub const AUDIO_EXTS: &[&str] = &["mp3", "wav", "m4a", "aac", "ogg", "flac"];

pub fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" | "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

/// Sous-dossiers de l'espace de travail.
pub struct Workspace {
    pub root: PathBuf,
}

impl Workspace {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn ensure(path: PathBuf) -> AppResult<PathBuf> {
        std::fs::create_dir_all(&path)?;
        Ok(path)
    }

    pub fn character_dir(&self, character_id: &str) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("characters").join(character_id))
    }

    pub fn clips_dir(&self, production_id: &str) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("productions").join(production_id).join("clips"))
    }

    pub fn thumbnails_dir(&self) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("thumbnails"))
    }

    pub fn audio_dir(&self) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("audio"))
    }

    pub fn logs_dir(&self) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("logs"))
    }

    pub fn tmp_dir(&self) -> AppResult<PathBuf> {
        Self::ensure(self.root.join("tmp"))
    }
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct StoredFile {
    pub path: PathBuf,
    pub original_name: String,
    pub size: i64,
    pub sha256: String,
    pub mime: String,
    /// Vrai si un fichier identique existait deja : aucune copie n'a ete faite.
    pub reused: bool,
}

pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Verifie qu'un fichier source existe et a une extension acceptee.
pub fn check_source(src: &Path, allowed: &[&str], what: &str) -> AppResult<String> {
    if !src.is_file() {
        return Err(AppError::not_found(format!("Fichier introuvable : {}", src.display())));
    }
    let ext = extension_lower(src);
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::validation(format!(
            "Format non pris en charge pour {what} : .{ext} (formats acceptés : {})",
            allowed.join(", ")
        )));
    }
    Ok(ext)
}

/// Fichier source analyse (sans verrou sur la base : le hachage peut etre long).
#[derive(Debug, Clone)]
pub struct SourceFile {
    pub path: PathBuf,
    pub ext: String,
    pub original_name: String,
    pub size: i64,
    pub sha256: String,
    pub mime: String,
}

pub fn inspect_source(src: &Path, allowed: &[&str], what: &str) -> AppResult<SourceFile> {
    let ext = check_source(src, allowed, what)?;
    let original_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("fichier.{ext}"));
    Ok(SourceFile {
        path: src.to_path_buf(),
        sha256: sha256_file(src)?,
        size: std::fs::metadata(src)?.len() as i64,
        mime: mime_for(&ext).into(),
        original_name,
        ext,
    })
}

/// Fichier deja gere avec le meme contenu et le meme type (deduplication).
pub fn find_existing(conn: &Connection, sha256: &str, kind: &str) -> AppResult<Option<PathBuf>> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT file_path FROM media_assets WHERE sha256 = ?1 AND kind = ?2 ORDER BY created_at LIMIT 1",
            params![sha256, kind],
            |r| r.get(0),
        )
        .optional()?;
    Ok(existing.map(PathBuf::from).filter(|p| p.is_file()))
}

/// Copie le fichier source dans `dest_dir` sous un nom UUID. L'original n'est jamais modifie.
pub fn copy_into(src: &SourceFile, dest_dir: &Path) -> AppResult<PathBuf> {
    std::fs::create_dir_all(dest_dir)?;
    let dest = dest_dir.join(format!("{}.{}", new_id(), src.ext));
    std::fs::copy(&src.path, &dest)?;
    Ok(dest)
}

/// Copie `src` dans `dest_dir` (nom UUID) sauf si un fichier identique du meme
/// type est deja gere par l'application. L'original n'est jamais modifie.
#[cfg(test)]
pub fn store_file(
    conn: &Connection,
    src: &Path,
    dest_dir: &Path,
    kind: &str,
    allowed: &[&str],
    what: &str,
) -> AppResult<StoredFile> {
    let source = inspect_source(src, allowed, what)?;
    let existing = find_existing(conn, &source.sha256, kind)?;
    let reused = existing.is_some();
    let path = match existing {
        Some(p) => p,
        None => copy_into(&source, dest_dir)?,
    };
    Ok(StoredFile {
        path,
        original_name: source.original_name,
        size: source.size,
        sha256: source.sha256,
        mime: source.mime,
        reused,
    })
}

/// Supprime un fichier gere si plus aucun media ne le reference.
pub fn remove_file_if_unreferenced(conn: &Connection, path: &str) -> AppResult<()> {
    let refs: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM media_assets WHERE file_path = ?1)
              + (SELECT COUNT(*) FROM media_assets WHERE thumbnail_path = ?1)",
        params![path],
        |r| r.get(0),
    )?;
    if refs == 0 {
        let p = Path::new(path);
        if p.is_file() {
            if let Err(e) = std::fs::remove_file(p) {
                // Un fichier verrouille (ex. ouvert dans un lecteur) ne doit pas bloquer l'operation.
                eprintln!("[media] suppression impossible de {} : {e}", path_to_string(p));
            }
        }
    }
    Ok(())
}

pub fn image_dimensions(path: &Path) -> Option<(i64, i64)> {
    imagesize::size(path).ok().map(|s| (s.width as i64, s.height as i64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn store_copies_and_dedupes() {
        let conn = db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("Pomme face.PNG");
        std::fs::write(&src, b"fake-png-bytes").unwrap();
        let dest = dir.path().join("ws");

        let stored = store_file(&conn, &src, &dest, "character_image", IMAGE_EXTS, "une image").unwrap();
        assert!(!stored.reused);
        assert!(stored.path.is_file());
        assert_eq!(stored.original_name, "Pomme face.PNG");
        assert_eq!(stored.mime, "image/png");
        // L'original est intact.
        assert_eq!(std::fs::read(&src).unwrap(), b"fake-png-bytes");

        conn.execute(
            "INSERT INTO media_assets (id, kind, file_path, original_name, sha256, created_at)
             VALUES ('a', 'character_image', ?1, 'x', ?2, 'now')",
            params![path_to_string(&stored.path), stored.sha256],
        )
        .unwrap();
        let again = store_file(&conn, &src, &dest, "character_image", IMAGE_EXTS, "une image").unwrap();
        assert!(again.reused);
        assert_eq!(again.path, stored.path);
    }

    #[test]
    fn rejects_unknown_extension() {
        let conn = db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("notes.txt");
        std::fs::write(&src, b"x").unwrap();
        let err = store_file(&conn, &src, dir.path(), "character_image", IMAGE_EXTS, "une image");
        assert!(matches!(err, Err(AppError::Validation(_))));
    }
}
