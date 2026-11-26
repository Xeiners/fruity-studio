//! Commandes Tauri exposees au frontend. Chaque commande est asynchrone pour ne
//! jamais bloquer le thread de l'interface ; les traitements longs (copie,
//! hachage, FFmpeg) sont deportes dans `spawn_blocking`.

pub mod characters;
pub mod gemini;
pub mod media;
pub mod networks;
pub mod productions;
pub mod render;
pub mod system;
pub mod tools;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport<T: Serialize> {
    pub imported: Vec<T>,
    pub failures: Vec<ImportFailure>,
}

/// Execute un traitement bloquant hors du thread asynchrone.
pub async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("Tâche interrompue : {e}")))?
}
