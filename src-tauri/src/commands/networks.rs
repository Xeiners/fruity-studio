//! TikTok et YouTube affiches dans l'application : des vues natives posees sur la fenetre.
//!
//! La session reste dans le profil WebView2 : une seule connexion suffit. Ces vues
//! chargent des sites extérieurs : l'adresse vient toujours de la liste ci-dessous,
//! jamais de l'interface, et les capacites Tauri (locales uniquement) leur refusent
//! les commandes de l'application.
//!
//! Commandes `async` obligatoires : sous Windows, `add_child` bloque depuis une commande synchrone.

use serde::Deserialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

struct Network {
    id: &'static str,
    label: &'static str,
    url: &'static str,
}

const NETWORKS: &[Network] = &[
    Network { id: "tiktok", label: "network-tiktok", url: "https://www.tiktok.com/tiktokstudio/upload" },
    Network { id: "youtube", label: "network-youtube", url: "https://www.youtube.com/upload" },
];

fn network(id: &str) -> AppResult<&'static Network> {
    NETWORKS.iter().find(|n| n.id == id).ok_or_else(|| AppError::validation("Réseau inconnu."))
}

/// Emplacement de la vue dans la fenetre, en pixels logiques.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn place(webview: &Webview, bounds: Bounds) -> AppResult<()> {
    webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
    webview.set_size(LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)))?;
    Ok(())
}

/// Seules les pages sur Internet en HTTPS : jamais l'application ni les fichiers locaux.
fn navigation_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "about" | "blob")
}

/// Affiche un reseau et masque l'autre. Une vue deja creee est reutilisee : un envoi en cours continue.
#[tauri::command]
pub async fn network_show(app: AppHandle, id: String, bounds: Bounds) -> AppResult<()> {
    let target = network(&id)?;
    let webview = match app.get_webview(target.label) {
        Some(existing) => existing,
        None => {
            let window = app
                .get_window("main")
                .ok_or_else(|| AppError::Other("Fenêtre principale introuvable.".into()))?;
            let url: Url = target.url.parse().map_err(|_| AppError::validation("Adresse du réseau invalide."))?;
            let builder = WebviewBuilder::new(target.label, WebviewUrl::External(url))
                // Laisse le site recevoir la video deposee depuis l'Explorateur.
                .disable_drag_drop_handler()
                .on_navigation(navigation_allowed);
            window.add_child(
                builder,
                LogicalPosition::new(bounds.x, bounds.y),
                LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
            )?
        }
    };
    place(&webview, bounds)?;
    webview.show()?;
    for other in NETWORKS.iter().filter(|n| n.id != target.id) {
        if let Some(view) = app.get_webview(other.label) {
            view.hide()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn network_set_bounds(app: AppHandle, id: String, bounds: Bounds) -> AppResult<()> {
    if let Some(view) = app.get_webview(network(&id)?.label) {
        place(&view, bounds)?;
    }
    Ok(())
}

/// Masque les vues sans les detruire : la session et un envoi en cours sont conserves.
#[tauri::command]
pub async fn network_hide_all(app: AppHandle) -> AppResult<()> {
    for item in NETWORKS {
        if let Some(view) = app.get_webview(item.label) {
            view.hide()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn network_reload(app: AppHandle, id: String) -> AppResult<()> {
    if let Some(view) = app.get_webview(network(&id)?.label) {
        view.reload()?;
    }
    Ok(())
}

/// Solution de repli si un site refuse la connexion dans une vue integree.
#[tauri::command]
pub async fn network_open_external(app: AppHandle, id: String) -> AppResult<()> {
    app.opener()
        .open_url(network(&id)?.url, None::<&str>)
        .map_err(|e| AppError::Other(format!("Impossible d'ouvrir le navigateur : {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_pages_can_load() {
        let allowed = |raw: &str| navigation_allowed(&raw.parse().unwrap());
        assert!(allowed("https://accounts.google.com/signin"));
        assert!(allowed("about:blank"));
        assert!(!allowed("http://localhost:1420/"));
        assert!(!allowed("file:///C:/Windows/win.ini"));
        assert!(!allowed("tauri://localhost/"));
    }

    #[test]
    fn unknown_networks_are_refused() {
        assert!(network("tiktok").is_ok());
        assert!(network("https://example.com").is_err());
    }
}
