//! Stockage securise de la cle API Gemini dans le trousseau du systeme
//! (Gestionnaire d'identification Windows). La cle n'est jamais renvoyee au
//! frontend ni ecrite dans les journaux : seul un indice (4 derniers caracteres)
//! est expose.

use std::sync::Mutex;

use serde::Serialize;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.fruitystudio.desktop";
const ACCOUNT: &str = "gemini-api-key";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    /// Ex. "••••a1B2" — jamais la cle complete.
    pub hint: Option<String>,
    pub storage: String,
}

/// Cache memoire (processus Rust uniquement) pour eviter de relire le trousseau
/// a chaque requete.
#[derive(Default)]
pub struct KeyCache(Mutex<Option<Option<String>>>);

fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| AppError::Secret(format!("Trousseau système indisponible : {e}")))
}

fn mask(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("••••{tail}")
}

pub fn validate_key_format(key: &str) -> AppResult<()> {
    if key.len() < 20 || key.len() > 256 {
        return Err(AppError::validation(
            "La clé API semble invalide (longueur inattendue). Copiez-la depuis Google AI Studio.",
        ));
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::validation("La clé API ne doit pas contenir d'espaces."));
    }
    Ok(())
}

impl KeyCache {
    pub fn get(&self) -> AppResult<Option<String>> {
        let mut guard = self.0.lock().map_err(|_| AppError::Other("Verrou du cache corrompu".into()))?;
        if let Some(cached) = guard.as_ref() {
            return Ok(cached.clone());
        }
        let value = match entry()?.get_password() {
            Ok(v) => Some(v),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => return Err(AppError::Secret(format!("Lecture du trousseau impossible : {e}"))),
        };
        *guard = Some(value.clone());
        Ok(value)
    }

    pub fn set(&self, key: &str) -> AppResult<()> {
        let key = key.trim();
        validate_key_format(key)?;
        entry()?
            .set_password(key)
            .map_err(|e| AppError::Secret(format!("Enregistrement dans le trousseau impossible : {e}")))?;
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(Some(key.to_string()));
        }
        Ok(())
    }

    pub fn clear(&self) -> AppResult<()> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Secret(format!("Suppression impossible : {e}"))),
        }
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(None);
        }
        Ok(())
    }

    pub fn status(&self) -> AppResult<KeyStatus> {
        let key = self.get()?;
        Ok(KeyStatus {
            configured: key.is_some(),
            hint: key.as_deref().map(mask),
            storage: "Gestionnaire d'identification Windows".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_keeps_only_last_four_chars() {
        assert_eq!(mask("AIzaSyExampleKey1234"), "••••1234");
    }

    #[test]
    fn rejects_bad_formats() {
        assert!(validate_key_format("short").is_err());
        assert!(validate_key_format("AIzaSy Example Key With Spaces").is_err());
        assert!(validate_key_format("AIzaSyAbcdefghijklmnopqrstuvwxyz012345").is_ok());
    }
}
