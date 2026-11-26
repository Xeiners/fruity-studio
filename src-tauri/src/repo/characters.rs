use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::models::{
    Character, CharacterDetail, CharacterGeneration, CharacterGenerationInput, CharacterInput, CharacterRef,
    CharacterSummary, MediaAsset, ProductionRef, Relationship, RelationshipInput,
};
use crate::repo::media::{asset_columns, row_to_asset};
use crate::util::{new_id, now};
use serde_json::Value;

const COLS: &str = "c.id, c.name, c.species, c.short_description, c.personality, c.behavior, c.voice, \
    c.mannerisms, c.appearance, c.distinctive_details, c.creative_notes, c.color, c.cover_image_id, \
    c.archived, c.created_at, c.updated_at, c.status, c.active_generation_id";
const COL_COUNT: usize = 18;

/// Chemin de l'image principale : image choisie, sinon premiere image de la galerie.
const COVER_PATH_SQL: &str = "COALESCE(
    (SELECT file_path FROM media_assets WHERE id = c.cover_image_id),
    (SELECT file_path FROM media_assets WHERE character_id = c.id AND kind = 'character_image'
        ORDER BY sort_order, created_at LIMIT 1))";

fn row_to_character(row: &Row, o: usize) -> rusqlite::Result<Character> {
    Ok(Character {
        id: row.get(o)?,
        name: row.get(o + 1)?,
        species: row.get(o + 2)?,
        short_description: row.get(o + 3)?,
        personality: row.get(o + 4)?,
        behavior: row.get(o + 5)?,
        voice: row.get(o + 6)?,
        mannerisms: row.get(o + 7)?,
        appearance: row.get(o + 8)?,
        distinctive_details: row.get(o + 9)?,
        creative_notes: row.get(o + 10)?,
        color: row.get(o + 11)?,
        cover_image_id: row.get(o + 12)?,
        archived: row.get::<_, i64>(o + 13)? != 0,
        created_at: row.get(o + 14)?,
        updated_at: row.get(o + 15)?,
        status: row.get(o + 16)?,
        active_generation_id: row.get(o + 17)?,
    })
}

fn validate(input: &CharacterInput) -> AppResult<CharacterInput> {
    let mut clean = input.clone();
    clean.name = clean.name.trim().to_string();
    clean.species = clean.species.trim().to_string();
    if clean.name.is_empty() {
        return Err(AppError::validation("Le nom du personnage est obligatoire."));
    }
    if clean.name.chars().count() > 60 {
        return Err(AppError::validation("Le nom ne doit pas dépasser 60 caractères."));
    }
    if clean.species.is_empty() {
        return Err(AppError::validation("Le fruit / l'espèce est obligatoire."));
    }
    if let Some(color) = &clean.color {
        let ok = color.len() == 7
            && color.starts_with('#')
            && color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            return Err(AppError::validation("La couleur doit être au format #RRGGBB."));
        }
    }
    Ok(clean)
}

pub fn list(conn: &Connection, include_archived: bool) -> AppResult<Vec<CharacterSummary>> {
    let sql = format!(
        "SELECT {COLS}, {COVER_PATH_SQL},
            (SELECT COUNT(*) FROM media_assets WHERE character_id = c.id AND kind = 'character_image'),
            (SELECT COUNT(*) FROM production_characters WHERE character_id = c.id)
         FROM characters c
         WHERE (?1 = 1 OR c.archived = 0)
         ORDER BY c.archived, c.name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![include_archived as i64], |r| {
        Ok(CharacterSummary {
            character: row_to_character(r, 0)?,
            cover_path: r.get(COL_COUNT)?,
            image_count: r.get(COL_COUNT + 1)?,
            production_count: r.get(COL_COUNT + 2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Character>> {
    let sql = format!("SELECT {COLS} FROM characters c WHERE c.id = ?1");
    Ok(conn.query_row(&sql, params![id], |r| row_to_character(r, 0)).optional()?)
}

pub fn require(conn: &Connection, id: &str) -> AppResult<Character> {
    get(conn, id)?.ok_or_else(|| AppError::not_found("Ce personnage n'existe plus."))
}

pub fn images(conn: &Connection, character_id: &str) -> AppResult<Vec<MediaAsset>> {
    let sql = format!(
        "SELECT {} FROM media_assets m WHERE m.character_id = ?1 AND m.kind = 'character_image'
         ORDER BY m.sort_order, m.created_at",
        asset_columns("m")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![character_id], |r| row_to_asset(r, 0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn relationships(conn: &Connection, character_id: &str) -> AppResult<Vec<Relationship>> {
    let sql = "SELECT r.id, 'outgoing', r.character_id, r.related_character_id, o.name, o.species, o.color,
                COALESCE((SELECT file_path FROM media_assets WHERE id = o.cover_image_id),
                         (SELECT file_path FROM media_assets WHERE character_id = o.id AND kind = 'character_image'
                            ORDER BY sort_order, created_at LIMIT 1)),
                r.relation, r.description
         FROM character_relationships r JOIN characters o ON o.id = r.related_character_id
         WHERE r.character_id = ?1
         UNION ALL
         SELECT r.id, 'incoming', r.character_id, r.character_id, o.name, o.species, o.color,
                COALESCE((SELECT file_path FROM media_assets WHERE id = o.cover_image_id),
                         (SELECT file_path FROM media_assets WHERE character_id = o.id AND kind = 'character_image'
                            ORDER BY sort_order, created_at LIMIT 1)),
                r.relation, r.description
         FROM character_relationships r JOIN characters o ON o.id = r.character_id
         WHERE r.related_character_id = ?1";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![character_id], |r| {
        Ok(Relationship {
            id: r.get(0)?,
            direction: r.get(1)?,
            character_id: r.get(2)?,
            related_character_id: r.get(3)?,
            related_name: r.get(4)?,
            related_species: r.get(5)?,
            related_color: r.get(6)?,
            related_cover_path: r.get(7)?,
            relation: r.get(8)?,
            description: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn detail(conn: &Connection, id: &str) -> AppResult<CharacterDetail> {
    let character = require(conn, id)?;
    let cover_path: Option<String> = conn.query_row(
        &format!("SELECT {COVER_PATH_SQL} FROM characters c WHERE c.id = ?1"),
        params![id],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.status, p.updated_at FROM production_characters pc
         JOIN productions p ON p.id = pc.production_id
         WHERE pc.character_id = ?1 ORDER BY p.updated_at DESC",
    )?;
    let productions = stmt
        .query_map(params![id], |r| {
            Ok(ProductionRef { id: r.get(0)?, title: r.get(1)?, status: r.get(2)?, updated_at: r.get(3)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CharacterDetail {
        images: images(conn, id)?,
        relationships: relationships(conn, id)?,
        productions,
        generations: generations(conn, id)?,
        cover_path,
        character,
    })
}

/// Un nouveau personnage commence en brouillon : ses images viendront plus tard.
pub fn create(conn: &Connection, input: &CharacterInput) -> AppResult<Character> {
    let input = validate(input)?;
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO characters (id, name, species, short_description, personality, behavior, voice, mannerisms,
            appearance, distinctive_details, creative_notes, color, archived, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 'draft', ?13, ?13)",
        params![
            id,
            input.name,
            input.species,
            input.short_description,
            input.personality,
            input.behavior.as_deref().unwrap_or(""),
            input.voice,
            input.mannerisms.as_deref().unwrap_or(""),
            input.appearance.as_deref().unwrap_or(""),
            input.distinctive_details.as_deref().unwrap_or(""),
            input.creative_notes.as_deref().unwrap_or(""),
            input.color.as_deref().unwrap_or("#B7F36B"),
            ts,
        ],
    )?;
    require(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &CharacterInput) -> AppResult<Character> {
    let input = validate(input)?;
    let changed = conn.execute(
        "UPDATE characters SET name = ?2, species = ?3, short_description = ?4, personality = ?5,
            behavior = COALESCE(?6, behavior), voice = ?7, mannerisms = COALESCE(?8, mannerisms),
            appearance = COALESCE(?9, appearance), distinctive_details = COALESCE(?10, distinctive_details),
            creative_notes = COALESCE(?11, creative_notes), color = COALESCE(?12, color), updated_at = ?13
         WHERE id = ?1",
        params![
            id,
            input.name,
            input.species,
            input.short_description,
            input.personality,
            input.behavior,
            input.voice,
            input.mannerisms,
            input.appearance,
            input.distinctive_details,
            input.creative_notes,
            input.color,
            now(),
        ],
    )?;
    if changed == 0 {
        return Err(AppError::not_found("Ce personnage n'existe plus."));
    }
    require(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<Character> {
    conn.execute(
        "UPDATE characters SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, archived as i64, now()],
    )?;
    require(conn, id)
}

pub fn set_status(conn: &Connection, id: &str, status: &str) -> AppResult<Character> {
    if status != "draft" && status != "ready" {
        return Err(AppError::validation("Statut de personnage inconnu."));
    }
    conn.execute(
        "UPDATE characters SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, now()],
    )?;
    require(conn, id)
}

// ---------------------------------------------------------------------------
// Versions generees par Gemini
// ---------------------------------------------------------------------------

const GENERATION_COLS: &str =
    "id, character_id, version, instruction, model, brief, identity, prompts, created_at, updated_at";

fn row_to_generation(r: &Row) -> rusqlite::Result<CharacterGeneration> {
    let json = |index: usize| -> rusqlite::Result<Value> {
        let raw: String = r.get(index)?;
        Ok(serde_json::from_str(&raw).unwrap_or(Value::Null))
    };
    Ok(CharacterGeneration {
        id: r.get(0)?,
        character_id: r.get(1)?,
        version: r.get(2)?,
        instruction: r.get(3)?,
        model: r.get(4)?,
        brief: json(5)?,
        identity: json(6)?,
        prompts: json(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

pub fn generations(conn: &Connection, character_id: &str) -> AppResult<Vec<CharacterGeneration>> {
    let sql = format!("SELECT {GENERATION_COLS} FROM character_generations WHERE character_id = ?1 ORDER BY version DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![character_id], row_to_generation)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn require_generation(conn: &Connection, id: &str) -> AppResult<CharacterGeneration> {
    let sql = format!("SELECT {GENERATION_COLS} FROM character_generations WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_generation)
        .optional()?
        .ok_or_else(|| AppError::not_found("Cette version n'existe plus."))
}

/// Enregistre une nouvelle version et en fait la version utilisee par l'application.
pub fn add_generation(
    conn: &Connection,
    character_id: &str,
    input: &CharacterGenerationInput,
) -> AppResult<CharacterGeneration> {
    require(conn, character_id)?;
    if !input.identity.is_object() || !input.prompts.is_array() {
        return Err(AppError::validation("Le contenu généré est incomplet."));
    }
    let tx = conn.unchecked_transaction()?;
    let version: i64 = tx.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM character_generations WHERE character_id = ?1",
        params![character_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    let ts = now();
    tx.execute(
        "INSERT INTO character_generations (id, character_id, version, instruction, model, brief, identity, prompts,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            character_id,
            version,
            input.instruction.trim(),
            input.model,
            input.brief.to_string(),
            input.identity.to_string(),
            input.prompts.to_string(),
            ts,
        ],
    )?;
    tx.execute(
        "UPDATE characters SET active_generation_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![character_id, id, ts],
    )?;
    tx.commit()?;
    require_generation(conn, &id)
}

/// Remplace le texte d'un seul prompt de cette version.
pub fn update_generation_prompt(
    conn: &Connection,
    generation_id: &str,
    key: &str,
    prompt: &str,
) -> AppResult<CharacterGeneration> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::validation("Le prompt ne peut pas être vide."));
    }
    let mut generation = require_generation(conn, generation_id)?;
    let entry = generation
        .prompts
        .as_array_mut()
        .and_then(|list| list.iter_mut().find(|p| p.get("key").and_then(Value::as_str) == Some(key)))
        .ok_or_else(|| AppError::not_found("Ce prompt n'existe plus."))?;
    entry["prompt"] = Value::String(prompt.to_string());
    conn.execute(
        "UPDATE character_generations SET prompts = ?2, updated_at = ?3 WHERE id = ?1",
        params![generation_id, generation.prompts.to_string(), now()],
    )?;
    touch(conn, &generation.character_id)?;
    require_generation(conn, generation_id)
}

pub fn activate_generation(conn: &Connection, character_id: &str, generation_id: &str) -> AppResult<Character> {
    let generation = require_generation(conn, generation_id)?;
    if generation.character_id != character_id {
        return Err(AppError::validation("Cette version appartient à un autre personnage."));
    }
    conn.execute(
        "UPDATE characters SET active_generation_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![character_id, generation_id, now()],
    )?;
    require(conn, character_id)
}

/// Supprime une version. Si c'etait la version utilisee, la plus recente restante prend le relais.
pub fn delete_generation(conn: &Connection, generation_id: &str) -> AppResult<Character> {
    let generation = require_generation(conn, generation_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM character_generations WHERE id = ?1", params![generation_id])?;
    tx.execute(
        "UPDATE characters SET updated_at = ?3,
            active_generation_id = CASE WHEN active_generation_id = ?2
                THEN (SELECT id FROM character_generations WHERE character_id = ?1 ORDER BY version DESC LIMIT 1)
                ELSE active_generation_id END
         WHERE id = ?1",
        params![generation.character_id, generation_id, now()],
    )?;
    tx.commit()?;
    require(conn, &generation.character_id)
}

pub fn set_cover(conn: &Connection, id: &str, asset_id: Option<&str>) -> AppResult<Character> {
    if let Some(asset_id) = asset_id {
        let owner: Option<String> = conn
            .query_row("SELECT character_id FROM media_assets WHERE id = ?1", params![asset_id], |r| r.get(0))
            .optional()?
            .flatten();
        if owner.as_deref() != Some(id) {
            return Err(AppError::validation("Cette image n'appartient pas à ce personnage."));
        }
    }
    conn.execute(
        "UPDATE characters SET cover_image_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, asset_id, now()],
    )?;
    require(conn, id)
}

pub fn touch(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE characters SET updated_at = ?2 WHERE id = ?1", params![id, now()])?;
    Ok(())
}

pub fn set_relationships(conn: &Connection, id: &str, rels: &[RelationshipInput]) -> AppResult<Vec<Relationship>> {
    require(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM character_relationships WHERE character_id = ?1", params![id])?;
    let mut seen = std::collections::HashSet::new();
    for rel in rels {
        let relation = rel.relation.trim();
        if rel.related_character_id == id || relation.is_empty() || !seen.insert(rel.related_character_id.clone()) {
            continue;
        }
        let exists: bool = tx
            .query_row("SELECT 1 FROM characters WHERE id = ?1", params![rel.related_character_id], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if !exists {
            continue;
        }
        tx.execute(
            "INSERT INTO character_relationships (id, character_id, related_character_id, relation, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), id, rel.related_character_id, relation, rel.description.trim(), now()],
        )?;
    }
    tx.execute("UPDATE characters SET updated_at = ?2 WHERE id = ?1", params![id, now()])?;
    tx.commit()?;
    relationships(conn, id)
}

/// Supprime le personnage et renvoie les ids des images a nettoyer.
pub fn delete(conn: &Connection, id: &str) -> AppResult<Vec<String>> {
    require(conn, id)?;
    let mut stmt = conn.prepare("SELECT id FROM media_assets WHERE character_id = ?1 AND kind = 'character_image'")?;
    let ids: Vec<String> = stmt.query_map(params![id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    drop(stmt);
    conn.execute("DELETE FROM characters WHERE id = ?1", params![id])?;
    Ok(ids)
}

pub fn next_image_order(conn: &Connection, character_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media_assets WHERE character_id = ?1 AND kind = 'character_image'",
        params![character_id],
        |r| r.get(0),
    )?)
}

pub fn refs_for_production(conn: &Connection, production_id: &str) -> AppResult<Vec<CharacterRef>> {
    let sql = format!(
        "SELECT c.id, c.name, c.species, c.color, {COVER_PATH_SQL}, c.archived
         FROM production_characters pc JOIN characters c ON c.id = pc.character_id
         WHERE pc.production_id = ?1 ORDER BY pc.position"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![production_id], |r| {
        Ok(CharacterRef {
            id: r.get(0)?,
            name: r.get(1)?,
            species: r.get(2)?,
            color: r.get(3)?,
            cover_path: r.get(4)?,
            archived: r.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn input(name: &str) -> CharacterInput {
        CharacterInput {
            name: name.into(),
            species: "Pomme".into(),
            short_description: String::new(),
            personality: "Dramatique".into(),
            voice: String::new(),
            behavior: None,
            mannerisms: None,
            appearance: None,
            distinctive_details: None,
            creative_notes: None,
            color: Some("#FF9B54".into()),
        }
    }

    fn generation_input() -> CharacterGenerationInput {
        CharacterGenerationInput {
            instruction: String::new(),
            model: "gemini-test".into(),
            brief: serde_json::json!({ "name": "Kevin" }),
            identity: serde_json::json!({ "summary": "Une banane" }),
            prompts: serde_json::json!([
                { "key": "front", "prompt": "Vue de face", "original": "Vue de face" },
                { "key": "back", "prompt": "Vue de dos", "original": "Vue de dos" },
            ]),
        }
    }

    #[test]
    fn new_characters_start_as_drafts() {
        let conn = db::open_in_memory().unwrap();
        let c = create(&conn, &input("Kevin")).unwrap();
        assert_eq!(c.status, "draft");
        assert_eq!(set_status(&conn, &c.id, "ready").unwrap().status, "ready");
        assert!(set_status(&conn, &c.id, "autre").is_err());
    }

    #[test]
    fn updating_essentials_keeps_older_fields() {
        let conn = db::open_in_memory().unwrap();
        let mut original = input("Pomme");
        original.appearance = Some("Ronde".into());
        original.creative_notes = Some("Ne gagne jamais".into());
        let c = create(&conn, &original).unwrap();

        let updated = update(&conn, &c.id, &input("Pomme Gala")).unwrap();
        assert_eq!(updated.name, "Pomme Gala");
        assert_eq!(updated.appearance, "Ronde");
        assert_eq!(updated.creative_notes, "Ne gagne jamais");
        assert_eq!(updated.color, "#FF9B54");

        let mut cleared = input("Pomme Gala");
        cleared.appearance = Some(String::new());
        assert_eq!(update(&conn, &c.id, &cleared).unwrap().appearance, "");
    }

    #[test]
    fn generations_are_versioned_and_the_latest_becomes_active() {
        let conn = db::open_in_memory().unwrap();
        let c = create(&conn, &input("Kevin")).unwrap();
        let first = add_generation(&conn, &c.id, &generation_input()).unwrap();
        let second = add_generation(&conn, &c.id, &generation_input()).unwrap();
        assert_eq!((first.version, second.version), (1, 2));

        let detail = detail(&conn, &c.id).unwrap();
        assert_eq!(detail.character.active_generation_id.as_deref(), Some(second.id.as_str()));
        assert_eq!(detail.generations[0].id, second.id);

        let back = activate_generation(&conn, &c.id, &first.id).unwrap();
        assert_eq!(back.active_generation_id.as_deref(), Some(first.id.as_str()));
    }

    #[test]
    fn editing_one_prompt_leaves_the_others_and_other_versions_alone() {
        let conn = db::open_in_memory().unwrap();
        let c = create(&conn, &input("Kevin")).unwrap();
        let first = add_generation(&conn, &c.id, &generation_input()).unwrap();
        let second = add_generation(&conn, &c.id, &generation_input()).unwrap();

        let edited = update_generation_prompt(&conn, &second.id, "front", "  Mon prompt  ").unwrap();
        assert_eq!(edited.prompts[0]["prompt"], "Mon prompt");
        assert_eq!(edited.prompts[0]["original"], "Vue de face");
        assert_eq!(edited.prompts[1]["prompt"], "Vue de dos");
        assert_eq!(require_generation(&conn, &first.id).unwrap().prompts[0]["prompt"], "Vue de face");

        assert!(update_generation_prompt(&conn, &second.id, "front", "   ").is_err());
        assert!(update_generation_prompt(&conn, &second.id, "inconnu", "x").is_err());
    }

    #[test]
    fn deleting_the_active_version_falls_back_to_the_latest() {
        let conn = db::open_in_memory().unwrap();
        let c = create(&conn, &input("Kevin")).unwrap();
        let first = add_generation(&conn, &c.id, &generation_input()).unwrap();
        let second = add_generation(&conn, &c.id, &generation_input()).unwrap();

        let after = delete_generation(&conn, &second.id).unwrap();
        assert_eq!(after.active_generation_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(delete_generation(&conn, &first.id).unwrap().active_generation_id, None);
    }

    #[test]
    fn activation_refuses_another_characters_version_and_delete_cascades() {
        let conn = db::open_in_memory().unwrap();
        let kevin = create(&conn, &input("Kevin")).unwrap();
        let other = create(&conn, &input("Pomme")).unwrap();
        let version = add_generation(&conn, &kevin.id, &generation_input()).unwrap();
        assert!(activate_generation(&conn, &other.id, &version.id).is_err());

        delete(&conn, &kevin.id).unwrap();
        assert!(require_generation(&conn, &version.id).is_err());
    }

    #[test]
    fn crud_and_relationships() {
        let conn = db::open_in_memory().unwrap();
        let a = create(&conn, &input("  Pomme  ")).unwrap();
        assert_eq!(a.name, "Pomme");
        let b = create(&conn, &input("Banane")).unwrap();

        let rels = set_relationships(
            &conn,
            &a.id,
            &[
                RelationshipInput { related_character_id: b.id.clone(), relation: "Rivale".into(), description: "".into() },
                RelationshipInput { related_character_id: a.id.clone(), relation: "Soi".into(), description: "".into() },
            ],
        )
        .unwrap();
        assert_eq!(rels.len(), 1);
        let incoming = relationships(&conn, &b.id).unwrap();
        assert_eq!(incoming.len(), 1);
        assert_eq!(incoming[0].direction, "incoming");
        assert_eq!(incoming[0].related_name, "Pomme");

        set_archived(&conn, &b.id, true).unwrap();
        assert_eq!(list(&conn, false).unwrap().len(), 1);
        assert_eq!(list(&conn, true).unwrap().len(), 2);

        delete(&conn, &b.id).unwrap();
        assert!(relationships(&conn, &a.id).unwrap().is_empty());
    }

    #[test]
    fn validation_errors() {
        let conn = db::open_in_memory().unwrap();
        assert!(create(&conn, &input("   ")).is_err());
        let mut bad = input("Kiwi");
        bad.color = Some("vert".into());
        assert!(create(&conn, &bad).is_err());
    }
}
