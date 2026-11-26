//! Petits utilitaires transverses.

use std::path::{Path, PathBuf};

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Nom de fichier/dossier sur pour Windows (caracteres interdits, noms reserves,
/// points/espaces finaux), limite en longueur pour rester sous MAX_PATH.
pub fn sanitize_file_name(input: &str, fallback: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    out = out.trim_end_matches(['.', ' ']).to_string();
    if out.chars().count() > 80 {
        out = out.chars().take(80).collect::<String>().trim_end_matches(['.', ' ']).to_string();
    }
    let upper = out.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let is_reserved = reserved.contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.chars().nth(3).is_some_and(|c| c.is_ascii_digit()));
    if out.is_empty() || is_reserved {
        fallback.to_string()
    } else {
        out
    }
}

/// Renvoie un chemin libre : `base/name.ext`, sinon `base/name (2).ext`, etc.
pub fn unique_path(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let make = |suffix: Option<usize>| {
        let name = match suffix {
            None => stem.to_string(),
            Some(n) => format!("{stem} ({n})"),
        };
        match ext {
            Some(e) if !e.is_empty() => dir.join(format!("{name}.{e}")),
            _ => dir.join(name),
        }
    };
    let first = make(None);
    if !first.exists() {
        return first;
    }
    (2..10_000).map(|n| make(Some(n))).find(|p| !p.exists()).unwrap_or(first)
}

pub fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Vrai si `path` est situe dans `root` (comparaison insensible a la casse sous Windows).
pub fn is_within(path: &Path, root: &Path) -> bool {
    let norm = |p: &Path| {
        let canonical = dunce_canonicalize(p);
        let s = canonical.to_string_lossy().replace('/', "\\");
        if cfg!(windows) { s.to_lowercase() } else { s }
    };
    let p = norm(path);
    let r = norm(root);
    let r = r.trim_end_matches('\\');
    p == r || p.starts_with(&format!("{r}\\"))
}

/// `canonicalize` sans le prefixe `\\?\` de Windows ; si le chemin n'existe pas,
/// on le renvoie tel quel.
pub fn dunce_canonicalize(path: &Path) -> PathBuf {
    match std::fs::canonicalize(path) {
        Ok(p) => {
            let s = p.to_string_lossy().to_string();
            if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
                PathBuf::from(format!(r"\\{stripped}"))
            } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
                PathBuf::from(stripped)
            } else {
                p
            }
        }
        Err(_) => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_names() {
        assert_eq!(sanitize_file_name("Pomme: la trahison?", "x"), "Pomme la trahison");
        assert_eq!(sanitize_file_name("CON", "fallback"), "fallback");
        assert_eq!(sanitize_file_name("  ...  ", "fallback"), "fallback");
        assert_eq!(sanitize_file_name("Clip.", "x"), "Clip");
        assert_eq!(sanitize_file_name("Écrasé à la crème", "x"), "Écrasé à la crème");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        let first = unique_path(dir.path(), "video", Some("mp4"));
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(dir.path(), "video", Some("mp4"));
        assert!(second.ends_with("video (2).mp4"));
    }

    #[test]
    fn within_root() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("a").join("b.txt");
        std::fs::create_dir_all(sub.parent().unwrap()).unwrap();
        std::fs::write(&sub, b"x").unwrap();
        assert!(is_within(&sub, dir.path()));
        assert!(!is_within(dir.path(), &sub));
    }
}
