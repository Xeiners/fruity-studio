use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Erreur applicative transmise au frontend sous la forme `{ kind, message }`.
/// Les messages sont en francais car ils sont affiches tels quels a l'utilisateur.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Erreur de base de données : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Ffmpeg(String),
    #[error("{0}")]
    Secret(String),
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Cancelled(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::NotFound(_) => "not_found",
            AppError::Validation(_) => "validation",
            AppError::Ffmpeg(_) => "ffmpeg",
            AppError::Secret(_) => "secret",
            AppError::Network(_) => "network",
            AppError::Cancelled(_) => "cancelled",
            AppError::Other(_) => "other",
        }
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        AppError::NotFound(what.into())
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        AppError::Other(format!("Données JSON invalides : {value}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(value: tauri::Error) -> Self {
        AppError::Other(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
