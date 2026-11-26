//! Passerelle Gemini : le SDK officiel `@google/genai` (frontend) envoie ses
//! requetes HTTP via une fonction `fetch` personnalisee qui appelle cette
//! commande. La cle API est injectee ici, cote Rust, depuis le trousseau
//! Windows : elle n'est jamais exposee au code JavaScript ni journalisee.

use std::io::Write as _;
use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::secrets::KeyStatus;
use crate::state::AppState;

const ALLOWED_HOST: &str = "generativelanguage.googleapis.com";

/// En-tetes jamais relayes depuis le frontend.
const BLOCKED_HEADERS: &[&str] = &[
    "x-goog-api-key",
    "authorization",
    "host",
    "content-length",
    "cookie",
    "connection",
    "origin",
    "referer",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiHttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

fn synthetic_error(status: u16, code: &str, message: &str) -> GeminiHttpResponse {
    let body = serde_json::json!({ "error": { "code": status, "status": code, "message": message } }).to_string();
    GeminiHttpResponse {
        status,
        status_text: code.to_string(),
        headers: vec![("content-type".into(), "application/json".into())],
        body,
    }
}

/// Valide l'URL (hote Gemini uniquement, HTTPS) et retire un eventuel parametre `key`.
pub fn sanitize_url(raw: &str) -> AppResult<reqwest::Url> {
    let mut url = reqwest::Url::parse(raw).map_err(|_| AppError::validation("URL Gemini invalide."))?;
    if url.scheme() != "https" || url.host_str() != Some(ALLOWED_HOST) {
        return Err(AppError::validation("Seule l'API Gemini officielle est autorisée."));
    }
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != "key")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    Ok(url)
}

const TIMING_FILE: &str = "temps-gemini.log";
const TIMING_MAX_BYTES: u64 = 64 * 1024;

/// Dernier segment de l'adresse : le modele et l'action, jamais la cle ni le contenu.
fn target_label(url: &reqwest::Url) -> String {
    url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("?").to_string()
}

/// Garde le temps reel de chaque appel, pour savoir ou part le temps sur cette machine.
fn record_timing(dir: &Path, line: &str) {
    let path = dir.join(TIMING_FILE);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > TIMING_MAX_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    let _ = std::fs::create_dir_all(dir);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

#[tauri::command]
pub async fn gemini_http(state: State<'_, AppState>, request: GeminiHttpRequest) -> AppResult<GeminiHttpResponse> {
    let url = sanitize_url(&request.url)?;
    let target = target_label(&url);
    let started = Instant::now();
    let result = forward(&state, request, url).await;
    let outcome = result.as_ref().map(|r| r.status.to_string()).unwrap_or_else(|_| "erreur".to_string());
    record_timing(
        &state.tools_dir,
        &format!("{} {target} {outcome} {} ms", crate::util::now(), started.elapsed().as_millis()),
    );
    result
}

async fn forward(state: &AppState, request: GeminiHttpRequest, url: reqwest::Url) -> AppResult<GeminiHttpResponse> {
    let Some(key) = state.keys.get()? else {
        return Ok(synthetic_error(
            401,
            "NO_API_KEY",
            "Aucune clé API Gemini n'est configurée. Ajoutez-la dans Paramètres > Gemini.",
        ));
    };
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|_| AppError::validation("Méthode HTTP invalide."))?;

    let mut builder = state.http.request(method, url);
    for (name, value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        if BLOCKED_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }
    builder = builder.header("x-goog-api-key", key);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return Ok(synthetic_error(
                504,
                "TIMEOUT",
                "Gemini n'a pas répondu à temps. Réessayez dans un instant.",
            ));
        }
        Err(e) if e.is_connect() => {
            return Err(AppError::Network(
                "Impossible de joindre l'API Gemini. Vérifiez votre connexion Internet.".into(),
            ));
        }
        Err(_) => {
            // Le detail de l'erreur reqwest peut contenir l'URL : on ne le relaie pas.
            return Err(AppError::Network("Erreur réseau lors de l'appel à Gemini.".into()));
        }
    };

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            let n = name.as_str();
            n == "content-type" || n == "retry-after" || n.starts_with("x-goog")
        })
        .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.as_str().to_string(), v.to_string())))
        .collect();
    let body = response
        .text()
        .await
        .map_err(|_| AppError::Network("Réponse Gemini interrompue.".into()))?;
    Ok(GeminiHttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
}

#[tauri::command]
pub async fn gemini_key_status(state: State<'_, AppState>) -> AppResult<KeyStatus> {
    state.keys.status()
}

#[tauri::command]
pub async fn gemini_key_set(state: State<'_, AppState>, key: String) -> AppResult<KeyStatus> {
    state.keys.set(&key)?;
    state.keys.status()
}

#[tauri::command]
pub async fn gemini_key_clear(state: State<'_, AppState>) -> AppResult<KeyStatus> {
    state.keys.clear()?;
    state.keys.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_gemini_host_is_allowed_and_key_param_is_removed() {
        let url = sanitize_url(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=SECRET&alt=json",
        )
        .unwrap();
        assert_eq!(url.query(), Some("alt=json"));
        assert!(!url.as_str().contains("SECRET"));
        assert!(sanitize_url("https://evil.example.com/v1beta/models").is_err());
        assert!(sanitize_url("http://generativelanguage.googleapis.com/v1beta/models").is_err());
    }

    #[test]
    fn timing_log_names_the_model_and_never_the_query() {
        let url = sanitize_url(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?alt=json",
        )
        .unwrap();
        assert_eq!(target_label(&url), "gemini-3.8-flash:generateContent");

        let dir = tempfile::tempdir().unwrap();
        record_timing(dir.path(), "premier appel");
        record_timing(dir.path(), "second appel");
        let text = std::fs::read_to_string(dir.path().join(TIMING_FILE)).unwrap();
        assert_eq!(text.lines().collect::<Vec<_>>(), ["premier appel", "second appel"]);
    }
}
