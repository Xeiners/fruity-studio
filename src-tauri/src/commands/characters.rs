use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use super::{ImportFailure, ImportReport, blocking};
use crate::error::{AppError, AppResult};
use crate::media::{self, IMAGE_EXTS};
use crate::models::{
    Character, CharacterDetail, CharacterGeneration, CharacterGenerationInput, CharacterInput, CharacterSummary,
    MediaAsset, ReferenceExportRequest, ReferenceExportResult, Relationship, RelationshipInput,
};
use crate::repo::{self, media::NewAsset};
use crate::state::AppState;
use crate::util::{extension_lower, path_to_string, sanitize_file_name, unique_path};

/// Angles de reference reconnus (cle stockee -> libelle francais).
pub const ANGLES: &[(&str, &str)] = &[
    ("sheet", "Fiche modèle"),
    ("front", "Face"),
    ("back", "Dos"),
    ("left", "Profil gauche"),
    ("right", "Profil droit"),
    ("three_quarter", "Trois-quarts"),
    ("expression", "Expression"),
    ("pose", "Pose"),
    ("other", "Autre"),
];

pub fn angle_label(key: &str) -> &'static str {
    ANGLES.iter().find(|(k, _)| *k == key).map(|(_, l)| *l).unwrap_or("Autre")
}

fn strip_accents(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

/// Devine l'angle d'une image d'apres son nom de fichier (modifiable ensuite).
pub fn guess_angle(file_name: &str) -> &'static str {
    let name = strip_accents(&file_name.to_lowercase());
    let has = |words: &[&str]| words.iter().any(|w| name.contains(w));
    if has(&["fiche", "model_sheet", "model-sheet", "turnaround"]) {
        "sheet"
    } else if has(&["three_quarter", "three-quarter", "3-4", "3_4", "3quart", "trois-quart", "trois_quart", "troisquart"]) {
        "three_quarter"
    } else if has(&["gauche", "left"]) {
        "left"
    } else if has(&["droit", "right"]) {
        "right"
    } else if has(&["back", "dos", "arriere", "behind"]) {
        "back"
    } else if has(&["front", "face", "avant"]) {
        "front"
    } else if has(&["expr", "emotion", "happy", "sad", "angry", "colere", "joie", "triste", "surpris"]) {
        "expression"
    } else if has(&["pose"]) {
        "pose"
    } else {
        "other"
    }
}

fn validate_angle(label: &str) -> AppResult<()> {
    if ANGLES.iter().any(|(k, _)| *k == label) {
        Ok(())
    } else {
        Err(AppError::validation("Angle de vue inconnu."))
    }
}

#[tauri::command]
pub async fn characters_list(state: State<'_, AppState>, include_archived: bool) -> AppResult<Vec<CharacterSummary>> {
    repo::characters::list(&*state.conn()?, include_archived)
}

#[tauri::command]
pub async fn character_get(state: State<'_, AppState>, id: String) -> AppResult<CharacterDetail> {
    repo::characters::detail(&*state.conn()?, &id)
}

#[tauri::command]
pub async fn character_create(state: State<'_, AppState>, input: CharacterInput) -> AppResult<Character> {
    repo::characters::create(&*state.conn()?, &input)
}

#[tauri::command]
pub async fn character_update(state: State<'_, AppState>, id: String, input: CharacterInput) -> AppResult<Character> {
    repo::characters::update(&*state.conn()?, &id, &input)
}

#[tauri::command]
pub async fn character_set_archived(state: State<'_, AppState>, id: String, archived: bool) -> AppResult<Character> {
    repo::characters::set_archived(&*state.conn()?, &id, archived)
}

#[tauri::command]
pub async fn character_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    // Le verrou de la base doit etre rendu avant `workspace()`, qui le reprend pour lire les parametres.
    {
        let conn = state.conn()?;
        let tx = conn.unchecked_transaction()?;
        let image_ids = repo::characters::delete(&tx, &id)?;
        for image_id in image_ids {
            repo::media::delete(&tx, &image_id)?;
        }
        tx.commit()?;
    }
    if let Ok(ws) = state.workspace() {
        let dir = ws.root.join("characters").join(&id);
        if dir.is_dir() && std::fs::read_dir(&dir).map(|mut d| d.next().is_none()).unwrap_or(false) {
            let _ = std::fs::remove_dir(dir);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn character_set_relationships(
    state: State<'_, AppState>,
    id: String,
    relationships: Vec<RelationshipInput>,
) -> AppResult<Vec<Relationship>> {
    repo::characters::set_relationships(&*state.conn()?, &id, &relationships)
}

#[tauri::command]
pub async fn character_set_cover(
    state: State<'_, AppState>,
    id: String,
    asset_id: Option<String>,
) -> AppResult<Character> {
    repo::characters::set_cover(&*state.conn()?, &id, asset_id.as_deref())
}

#[tauri::command]
pub async fn character_set_status(state: State<'_, AppState>, id: String, status: String) -> AppResult<Character> {
    repo::characters::set_status(&*state.conn()?, &id, &status)
}

#[tauri::command]
pub async fn character_generation_save(
    state: State<'_, AppState>,
    character_id: String,
    input: CharacterGenerationInput,
) -> AppResult<CharacterGeneration> {
    repo::characters::add_generation(&*state.conn()?, &character_id, &input)
}

#[tauri::command]
pub async fn character_generation_update_prompt(
    state: State<'_, AppState>,
    generation_id: String,
    key: String,
    prompt: String,
) -> AppResult<CharacterGeneration> {
    repo::characters::update_generation_prompt(&*state.conn()?, &generation_id, &key, &prompt)
}

#[tauri::command]
pub async fn character_generation_activate(
    state: State<'_, AppState>,
    character_id: String,
    generation_id: String,
) -> AppResult<Character> {
    repo::characters::activate_generation(&*state.conn()?, &character_id, &generation_id)
}

#[tauri::command]
pub async fn character_generation_delete(state: State<'_, AppState>, generation_id: String) -> AppResult<Character> {
    repo::characters::delete_generation(&*state.conn()?, &generation_id)
}

/// `label` / `caption` : vue precise (import depuis un prompt). Sinon l'angle est devine du nom de fichier.
#[tauri::command]
pub async fn character_import_images(
    app: AppHandle,
    character_id: String,
    paths: Vec<String>,
    label: Option<String>,
    caption: Option<String>,
) -> AppResult<ImportReport<MediaAsset>> {
    if let Some(label) = &label {
        validate_angle(label)?;
    }
    blocking(move || {
        let state = app.state::<AppState>();
        repo::characters::require(&*state.conn()?, &character_id)?;
        let dest = state.workspace()?.character_dir(&character_id)?;
        state.allow_directory(&app, &dest);
        let mut imported = Vec::new();
        let mut failures = Vec::new();
        for raw in paths {
            let result = (|| -> AppResult<MediaAsset> {
                let source = media::inspect_source(Path::new(&raw), IMAGE_EXTS, "une image de référence")?;
                let existing = media::find_existing(&*state.conn()?, &source.sha256, "character_image")?;
                let stored_path = match existing {
                    Some(p) => p,
                    None => media::copy_into(&source, &dest)?,
                };
                let dims = media::image_dimensions(&stored_path);
                let conn = state.conn()?;
                let order = repo::characters::next_image_order(&conn, &character_id)?;
                let asset = repo::media::insert(
                    &conn,
                    &NewAsset {
                        kind: "character_image".into(),
                        file_path: path_to_string(&stored_path),
                        original_name: source.original_name.clone(),
                        mime_type: source.mime.clone(),
                        size_bytes: source.size,
                        sha256: Some(source.sha256.clone()),
                        width: dims.map(|d| d.0),
                        height: dims.map(|d| d.1),
                        character_id: Some(character_id.clone()),
                        label: label.clone().unwrap_or_else(|| guess_angle(&source.original_name).into()),
                        caption: caption.clone().unwrap_or_default(),
                        sort_order: order,
                        ..Default::default()
                    },
                )?;
                Ok(asset)
            })();
            match result {
                Ok(asset) => imported.push(asset),
                Err(e) => failures.push(ImportFailure { path: raw, message: e.to_string() }),
            }
        }
        if !imported.is_empty() {
            repo::characters::touch(&*state.conn()?, &character_id)?;
        }
        Ok(ImportReport { imported, failures })
    })
    .await
}

#[tauri::command]
pub async fn character_image_update(
    state: State<'_, AppState>,
    asset_id: String,
    label: String,
    caption: String,
) -> AppResult<MediaAsset> {
    validate_angle(&label)?;
    let conn = state.conn()?;
    let asset = repo::media::require(&conn, &asset_id)?;
    if asset.kind != "character_image" {
        return Err(AppError::validation("Ce média n'est pas une image de personnage."));
    }
    repo::media::update_label(&conn, &asset_id, &label, caption.trim())
}

/// Remplace le fichier d'une image (l'angle et la legende sont conserves).
#[tauri::command]
pub async fn character_image_replace(app: AppHandle, asset_id: String, path: String) -> AppResult<MediaAsset> {
    blocking(move || {
        let state = app.state::<AppState>();
        let asset = repo::media::require(&*state.conn()?, &asset_id)?;
        let character_id = asset
            .character_id
            .clone()
            .ok_or_else(|| AppError::validation("Cette image n'est liée à aucun personnage."))?;
        let source = media::inspect_source(Path::new(&path), IMAGE_EXTS, "une image de référence")?;
        let dest = state.workspace()?.character_dir(&character_id)?;
        let existing = media::find_existing(&*state.conn()?, &source.sha256, "character_image")?;
        let stored_path = match existing {
            Some(p) => p,
            None => media::copy_into(&source, &dest)?,
        };
        let dims = media::image_dimensions(&stored_path);
        let conn = state.conn()?;
        conn.execute(
            "UPDATE media_assets SET file_path = ?2, original_name = ?3, mime_type = ?4, size_bytes = ?5,
                sha256 = ?6, width = ?7, height = ?8 WHERE id = ?1",
            rusqlite::params![
                asset_id,
                path_to_string(&stored_path),
                source.original_name,
                source.mime,
                source.size,
                source.sha256,
                dims.map(|d| d.0),
                dims.map(|d| d.1)
            ],
        )?;
        media::remove_file_if_unreferenced(&conn, &asset.file_path)?;
        repo::characters::touch(&conn, &character_id)?;
        repo::media::require(&conn, &asset_id)
    })
    .await
}

#[tauri::command]
pub async fn character_image_delete(state: State<'_, AppState>, asset_id: String) -> AppResult<()> {
    let conn = state.conn()?;
    let asset = repo::media::require(&conn, &asset_id)?;
    if asset.kind != "character_image" {
        return Err(AppError::validation("Ce média n'est pas une image de personnage."));
    }
    repo::media::delete(&conn, &asset_id)?;
    if let Some(cid) = asset.character_id {
        repo::characters::touch(&conn, &cid)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn character_images_reorder(
    state: State<'_, AppState>,
    character_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<MediaAsset>> {
    let conn = state.conn()?;
    let tx = conn.unchecked_transaction()?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE media_assets SET sort_order = ?3 WHERE id = ?1 AND character_id = ?2",
            rusqlite::params![id, character_id, index as i64],
        )?;
    }
    tx.commit()?;
    repo::characters::images(&conn, &character_id)
}

/// Rassemble les images de reference choisies dans un dossier, pret a etre
/// importe dans Google Flow (Flow n'a pas acces aux fichiers de Fruity Studio).
#[tauri::command]
pub async fn references_export(app: AppHandle, request: ReferenceExportRequest) -> AppResult<ReferenceExportResult> {
    blocking(move || {
        let state = app.state::<AppState>();
        if request.character_ids.is_empty() {
            return Err(AppError::validation("Aucun personnage sélectionné pour l'export."));
        }
        let base = match request.dest_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            Some(d) => PathBuf::from(d),
            None => PathBuf::from(state.settings()?.export_dir),
        };
        std::fs::create_dir_all(&base)?;
        let folder_name = sanitize_file_name(&format!("{} - références Flow", request.title), "Références Flow");
        let folder = unique_path(&base, &folder_name, None);
        std::fs::create_dir_all(&folder)?;

        let mut readme = vec![
            format!("Fruity Studio — références visuelles : {}", request.title),
            String::new(),
            "Google Flow n'a pas accès aux fichiers de Fruity Studio.".to_string(),
            "Importez ces images dans Flow comme références visuelles des personnages, puis collez le prompt du clip correspondant.".to_string(),
            String::new(),
        ];
        let mut count = 0usize;
        let conn = state.conn()?;
        for character_id in &request.character_ids {
            let character = repo::characters::require(&conn, character_id)?;
            let images = repo::characters::images(&conn, character_id)?;
            let selected: Vec<_> = images
                .into_iter()
                .filter(|img| request.asset_ids.as_ref().is_none_or(|ids| ids.contains(&img.id)))
                .collect();
            readme.push(format!("{} ({})", character.name, character.species));
            if selected.is_empty() {
                readme.push("  (aucune image exportée)".into());
            }
            for img in selected {
                let src = Path::new(&img.file_path);
                if !src.is_file() {
                    readme.push(format!("  - fichier manquant : {}", img.original_name));
                    continue;
                }
                let stem = sanitize_file_name(&format!("{} - {}", character.name, angle_label(&img.label)), "image");
                let ext = extension_lower(src);
                let dest = unique_path(&folder, &stem, Some(&ext));
                std::fs::copy(src, &dest)?;
                count += 1;
                let caption = if img.caption.is_empty() { String::new() } else { format!(" — {}", img.caption) };
                readme.push(format!(
                    "  - {}{caption}",
                    dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
                ));
            }
            readme.push(String::new());
        }
        drop(conn);
        if let Some(notes) = request.notes.as_deref().filter(|n| !n.trim().is_empty()) {
            readme.push("----".into());
            readme.push(notes.to_string());
        }
        std::fs::write(folder.join("LISEZMOI.txt"), readme.join("\r\n"))?;
        let _ = app.opener().open_path(path_to_string(&folder), None::<&str>);
        Ok(ReferenceExportResult { folder: path_to_string(&folder), file_count: count })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guesses_angles_from_file_names() {
        assert_eq!(guess_angle("kevin_fiche.png"), "sheet");
        assert_eq!(guess_angle("pomme_face.png"), "front");
        assert_eq!(guess_angle("Pomme - Profil Gauche.jpg"), "left");
        assert_eq!(guess_angle("banana_right.webp"), "right");
        assert_eq!(guess_angle("kiwi-3-4.png"), "three_quarter");
        assert_eq!(guess_angle("vue de dos.png"), "back");
        assert_eq!(guess_angle("colère.png"), "expression");
        assert_eq!(guess_angle("IMG_0042.png"), "other");
    }
}
