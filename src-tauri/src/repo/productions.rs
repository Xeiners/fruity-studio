use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::{
    Clip, ClipInput, ClipUpdateInput, Production, ProductionCreateInput, ProductionDetail, ProductionSummary,
    ProductionUpdateInput, StoryReplaceInput,
};
use crate::repo::{characters, media};
use crate::util::{new_id, now};

const COLS: &str = "p.id, p.title, p.status, p.synopsis, p.target_duration, p.clip_duration, p.params, p.story, \
    p.render_settings, p.final_video_id, p.rendered_at, p.thumbnail_path, p.created_at, p.updated_at";
const COL_COUNT: usize = 14;

fn parse_json(raw: String) -> Value {
    serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
}

fn row_to_production(row: &Row, o: usize) -> rusqlite::Result<Production> {
    Ok(Production {
        id: row.get(o)?,
        title: row.get(o + 1)?,
        status: row.get(o + 2)?,
        synopsis: row.get(o + 3)?,
        target_duration: row.get(o + 4)?,
        clip_duration: row.get(o + 5)?,
        params: parse_json(row.get(o + 6)?),
        story: parse_json(row.get(o + 7)?),
        render_settings: parse_json(row.get(o + 8)?),
        final_video_id: row.get(o + 9)?,
        rendered_at: row.get(o + 10)?,
        thumbnail_path: row.get(o + 11)?,
        created_at: row.get(o + 12)?,
        updated_at: row.get(o + 13)?,
    })
}

const CLIP_COLS: &str = "cl.id, cl.production_id, cl.clip_number, cl.duration, cl.content, cl.flow_prompt, \
    cl.prompt_edited, cl.video_asset_id, cl.video_imported_at, cl.created_at, cl.updated_at";
const CLIP_COL_COUNT: usize = 11;

fn row_to_clip(row: &Row) -> rusqlite::Result<Clip> {
    let has_video: Option<String> = row.get(CLIP_COL_COUNT)?;
    let video = match has_video {
        Some(_) => Some(media::row_to_asset(row, CLIP_COL_COUNT)?),
        None => None,
    };
    Ok(Clip {
        id: row.get(0)?,
        production_id: row.get(1)?,
        clip_number: row.get(2)?,
        duration: row.get(3)?,
        content: parse_json(row.get(4)?),
        flow_prompt: row.get(5)?,
        prompt_edited: row.get::<_, i64>(6)? != 0,
        video_asset_id: row.get(7)?,
        video_imported_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        video,
    })
}

fn validate_durations(target: i64, clip: i64) -> AppResult<()> {
    if !(5..=600).contains(&target) {
        return Err(AppError::validation("La durée cible doit être comprise entre 5 et 600 secondes."));
    }
    if !(2..=60).contains(&clip) {
        return Err(AppError::validation("La durée d'un clip doit être comprise entre 2 et 60 secondes."));
    }
    Ok(())
}

fn validate_clips(clips: &[ClipInput]) -> AppResult<()> {
    for (index, clip) in clips.iter().enumerate() {
        if clip.clip_number != index as i64 + 1 {
            return Err(AppError::validation(format!(
                "Numérotation des clips incohérente : le clip en position {} porte le numéro {}.",
                index + 1,
                clip.clip_number
            )));
        }
        if clip.duration <= 0 {
            return Err(AppError::validation("Chaque clip doit avoir une durée positive."));
        }
    }
    Ok(())
}

fn clean_title(title: &str) -> AppResult<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(AppError::validation("Le titre de la production est obligatoire."));
    }
    Ok(t.chars().take(120).collect())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Production>> {
    let sql = format!("SELECT {COLS} FROM productions p WHERE p.id = ?1");
    Ok(conn.query_row(&sql, params![id], |r| row_to_production(r, 0)).optional()?)
}

pub fn require(conn: &Connection, id: &str) -> AppResult<Production> {
    get(conn, id)?.ok_or_else(|| AppError::not_found("Cette production n'existe plus."))
}

pub fn list(conn: &Connection) -> AppResult<Vec<ProductionSummary>> {
    let sql = format!(
        "SELECT {COLS},
            (SELECT COUNT(*) FROM clips WHERE production_id = p.id),
            (SELECT COUNT(*) FROM clips WHERE production_id = p.id AND video_asset_id IS NOT NULL),
            (SELECT m.thumbnail_path FROM clips c JOIN media_assets m ON m.id = c.video_asset_id
               WHERE c.production_id = p.id AND m.thumbnail_path IS NOT NULL ORDER BY c.clip_number LIMIT 1),
            (SELECT file_path FROM media_assets WHERE id = p.final_video_id)
         FROM productions p ORDER BY p.updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        let production = row_to_production(r, 0)?;
        let clip_thumb: Option<String> = r.get(COL_COUNT + 2)?;
        Ok(ProductionSummary {
            preview_thumbnail: production.thumbnail_path.clone().or(clip_thumb),
            clip_count: r.get(COL_COUNT)?,
            imported_count: r.get(COL_COUNT + 1)?,
            final_video_path: r.get(COL_COUNT + 3)?,
            characters: Vec::new(),
            production,
        })
    })?;
    let mut list = rows.collect::<Result<Vec<_>, _>>()?;
    for item in &mut list {
        item.characters = characters::refs_for_production(conn, &item.production.id)?;
    }
    Ok(list)
}

pub fn clips(conn: &Connection, production_id: &str) -> AppResult<Vec<Clip>> {
    let sql = format!(
        "SELECT {CLIP_COLS}, {} FROM clips cl
         LEFT JOIN media_assets m ON m.id = cl.video_asset_id
         WHERE cl.production_id = ?1 ORDER BY cl.clip_number",
        media::asset_columns("m")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![production_id], row_to_clip)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn clip(conn: &Connection, clip_id: &str) -> AppResult<Clip> {
    let sql = format!(
        "SELECT {CLIP_COLS}, {} FROM clips cl
         LEFT JOIN media_assets m ON m.id = cl.video_asset_id
         WHERE cl.id = ?1",
        media::asset_columns("m")
    );
    conn.query_row(&sql, params![clip_id], row_to_clip)
        .optional()?
        .ok_or_else(|| AppError::not_found("Ce clip n'existe plus."))
}

pub fn detail(conn: &Connection, id: &str) -> AppResult<ProductionDetail> {
    let production = require(conn, id)?;
    let final_video = match &production.final_video_id {
        Some(asset_id) => media::get(conn, asset_id)?,
        None => None,
    };
    Ok(ProductionDetail {
        clips: clips(conn, id)?,
        characters: characters::refs_for_production(conn, id)?,
        final_video,
        production,
    })
}

fn set_characters(conn: &Connection, production_id: &str, character_ids: &[String]) -> AppResult<()> {
    conn.execute("DELETE FROM production_characters WHERE production_id = ?1", params![production_id])?;
    let mut seen = std::collections::HashSet::new();
    for (position, character_id) in character_ids.iter().enumerate() {
        if !seen.insert(character_id) {
            continue;
        }
        characters::require(conn, character_id)?;
        conn.execute(
            "INSERT INTO production_characters (production_id, character_id, position) VALUES (?1, ?2, ?3)",
            params![production_id, character_id, position as i64],
        )?;
    }
    Ok(())
}

fn insert_clips(conn: &Connection, production_id: &str, clips: &[ClipInput]) -> AppResult<()> {
    let ts = now();
    for clip in clips {
        conn.execute(
            "INSERT INTO clips (id, production_id, clip_number, duration, content, flow_prompt, prompt_edited, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
            params![
                new_id(),
                production_id,
                clip.clip_number,
                clip.duration,
                serde_json::to_string(&clip.content)?,
                clip.flow_prompt,
                ts,
            ],
        )?;
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &ProductionCreateInput) -> AppResult<ProductionDetail> {
    let title = clean_title(&input.title)?;
    validate_durations(input.target_duration, input.clip_duration)?;
    validate_clips(&input.clips)?;
    if input.character_ids.is_empty() {
        return Err(AppError::validation("Sélectionnez au moins un personnage."));
    }
    let id = new_id();
    let ts = now();
    let status = if input.clips.is_empty() { "draft" } else { "generated" };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO productions (id, title, status, synopsis, target_duration, clip_duration, params, story,
            render_settings, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '{}', ?9, ?9)",
        params![
            id,
            title,
            status,
            input.synopsis.trim(),
            input.target_duration,
            input.clip_duration,
            serde_json::to_string(&input.params)?,
            serde_json::to_string(&input.story)?,
            ts,
        ],
    )?;
    set_characters(&tx, &id, &input.character_ids)?;
    insert_clips(&tx, &id, &input.clips)?;
    tx.commit()?;
    detail(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &ProductionUpdateInput) -> AppResult<Production> {
    let current = require(conn, id)?;
    let title = match &input.title {
        Some(t) => clean_title(t)?,
        None => current.title,
    };
    let synopsis = input.synopsis.clone().unwrap_or(current.synopsis);
    let params_json = serde_json::to_string(input.params.as_ref().unwrap_or(&current.params))?;
    let story_json = serde_json::to_string(input.story.as_ref().unwrap_or(&current.story))?;
    let render_json = serde_json::to_string(input.render_settings.as_ref().unwrap_or(&current.render_settings))?;
    conn.execute(
        "UPDATE productions SET title = ?2, synopsis = ?3, params = ?4, story = ?5, render_settings = ?6, updated_at = ?7
         WHERE id = ?1",
        params![id, title, synopsis, params_json, story_json, render_json, now()],
    )?;
    require(conn, id)
}

/// Remplace l'histoire complete (regeneration). Les videos importees sont
/// detachees des clips mais restent dans la mediatheque.
pub fn replace_story(conn: &Connection, id: &str, input: &StoryReplaceInput) -> AppResult<ProductionDetail> {
    let current = require(conn, id)?;
    validate_durations(input.target_duration, input.clip_duration)?;
    validate_clips(&input.clips)?;
    if input.character_ids.is_empty() {
        return Err(AppError::validation("Sélectionnez au moins un personnage."));
    }
    let title = match &input.title {
        Some(t) if !t.trim().is_empty() => clean_title(t)?,
        _ => current.title,
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM clips WHERE production_id = ?1", params![id])?;
    tx.execute(
        "UPDATE productions SET title = ?2, synopsis = ?3, target_duration = ?4, clip_duration = ?5, params = ?6,
            story = ?7, status = 'generated', final_video_id = NULL, rendered_at = NULL, updated_at = ?8
         WHERE id = ?1",
        params![
            id,
            title,
            input.synopsis.trim(),
            input.target_duration,
            input.clip_duration,
            serde_json::to_string(&input.params)?,
            serde_json::to_string(&input.story)?,
            now(),
        ],
    )?;
    set_characters(&tx, id, &input.character_ids)?;
    insert_clips(&tx, id, &input.clips)?;
    tx.commit()?;
    detail(conn, id)
}

/// Supprime la production et les medias geres qui lui sont propres.
/// Les rendus exportes restent sur le disque (seule leur fiche est retiree).
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    require(conn, id)?;
    let mut stmt = conn.prepare(
        "SELECT id FROM media_assets WHERE production_id = ?1 AND kind IN ('clip_video', 'render')
         UNION SELECT video_asset_id FROM clips WHERE production_id = ?1 AND video_asset_id IS NOT NULL",
    )?;
    let asset_ids: Vec<String> = stmt.query_map(params![id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    drop(stmt);
    for asset_id in asset_ids {
        if media::get(conn, &asset_id)?.is_some() {
            media::delete(conn, &asset_id)?;
        }
    }
    conn.execute("DELETE FROM productions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn touch(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE productions SET updated_at = ?2 WHERE id = ?1", params![id, now()])?;
    Ok(())
}

pub fn update_clip(conn: &Connection, clip_id: &str, input: &ClipUpdateInput) -> AppResult<Clip> {
    let current = clip(conn, clip_id)?;
    let content = serde_json::to_string(input.content.as_ref().unwrap_or(&current.content))?;
    let prompt = input.flow_prompt.clone().unwrap_or(current.flow_prompt);
    let edited = input.prompt_edited.unwrap_or(current.prompt_edited);
    conn.execute(
        "UPDATE clips SET content = ?2, flow_prompt = ?3, prompt_edited = ?4, updated_at = ?5 WHERE id = ?1",
        params![clip_id, content, prompt, edited as i64, now()],
    )?;
    touch(conn, &current.production_id)?;
    clip(conn, clip_id)
}

/// Associe une video a un clip et renvoie l'id de l'ancienne video eventuelle.
pub fn set_clip_video(conn: &Connection, clip_id: &str, asset_id: Option<&str>) -> AppResult<Option<String>> {
    let current = clip(conn, clip_id)?;
    let ts = now();
    conn.execute(
        "UPDATE clips SET video_asset_id = ?2, video_imported_at = CASE WHEN ?2 IS NULL THEN NULL ELSE ?3 END,
            updated_at = ?3 WHERE id = ?1",
        params![clip_id, asset_id, ts],
    )?;
    touch(conn, &current.production_id)?;
    Ok(current.video_asset_id)
}

pub fn set_rendered(conn: &Connection, id: &str, asset_id: &str, thumbnail: Option<&str>) -> AppResult<()> {
    let ts = now();
    conn.execute(
        "UPDATE productions SET status = 'rendered', final_video_id = ?2, rendered_at = ?3,
            thumbnail_path = COALESCE(?4, thumbnail_path), updated_at = ?3
         WHERE id = ?1",
        params![id, asset_id, ts, thumbnail],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CharacterInput;
    use serde_json::json;

    fn character(conn: &Connection, name: &str) -> String {
        characters::create(
            conn,
            &CharacterInput {
                name: name.into(),
                species: "Fruit".into(),
                short_description: String::new(),
                personality: String::new(),
                voice: String::new(),
                behavior: None,
                mannerisms: None,
                appearance: None,
                distinctive_details: None,
                creative_notes: None,
                color: None,
            },
        )
        .unwrap()
        .id
    }

    fn clip_input(n: i64) -> ClipInput {
        ClipInput { clip_number: n, duration: 10, content: json!({"sceneDescription": format!("Scène {n}")}), flow_prompt: format!("Prompt {n}") }
    }

    #[test]
    fn create_update_and_replace() {
        let conn = crate::db::open_in_memory().unwrap();
        let a = character(&conn, "Pomme");
        let b = character(&conn, "Banane");
        let detail = create(
            &conn,
            &ProductionCreateInput {
                title: "La trahison".into(),
                synopsis: "Synopsis".into(),
                target_duration: 30,
                clip_duration: 10,
                params: json!({"language": "fr"}),
                story: json!({"hook": "Hook"}),
                character_ids: vec![a.clone(), b.clone()],
                clips: vec![clip_input(1), clip_input(2), clip_input(3)],
            },
        )
        .unwrap();
        assert_eq!(detail.production.status, "generated");
        assert_eq!(detail.clips.len(), 3);
        assert_eq!(detail.characters.len(), 2);
        assert_eq!(detail.clips[1].content["sceneDescription"], "Scène 2");

        let updated = update_clip(
            &conn,
            &detail.clips[0].id,
            &ClipUpdateInput { flow_prompt: Some("Nouveau".into()), prompt_edited: Some(true), content: None },
        )
        .unwrap();
        assert_eq!(updated.flow_prompt, "Nouveau");
        assert!(updated.prompt_edited);

        let summaries = list(&conn).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].clip_count, 3);
        assert_eq!(summaries[0].imported_count, 0);

        let replaced = replace_story(
            &conn,
            &detail.production.id,
            &StoryReplaceInput {
                title: None,
                synopsis: "Autre".into(),
                target_duration: 20,
                clip_duration: 10,
                params: json!({}),
                story: json!({}),
                character_ids: vec![b.clone()],
                clips: vec![clip_input(1), clip_input(2)],
            },
        )
        .unwrap();
        assert_eq!(replaced.clips.len(), 2);
        assert_eq!(replaced.production.title, "La trahison");
        assert_eq!(replaced.characters.len(), 1);

        delete(&conn, &detail.production.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_clip_numbering() {
        let conn = crate::db::open_in_memory().unwrap();
        let a = character(&conn, "Kiwi");
        let err = create(
            &conn,
            &ProductionCreateInput {
                title: "X".into(),
                synopsis: String::new(),
                target_duration: 30,
                clip_duration: 10,
                params: json!({}),
                story: json!({}),
                character_ids: vec![a],
                clips: vec![clip_input(1), clip_input(3)],
            },
        );
        assert!(matches!(err, Err(AppError::Validation(_))));
    }
}
