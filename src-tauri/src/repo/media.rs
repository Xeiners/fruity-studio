use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::media::remove_file_if_unreferenced;
use crate::models::{MediaAsset, MediaItem};
use crate::util::{new_id, now};

pub fn asset_columns(alias: &str) -> String {
    [
        "id", "kind", "file_path", "original_name", "mime_type", "size_bytes", "width", "height",
        "duration_ms", "fps", "video_codec", "audio_codec", "has_audio", "thumbnail_path",
        "parent_id", "character_id", "production_id", "label", "caption", "sort_order", "created_at",
    ]
    .iter()
    .map(|c| format!("{alias}.{c}"))
    .collect::<Vec<_>>()
    .join(", ")
}

pub const ASSET_COLUMN_COUNT: usize = 21;

pub fn row_to_asset(row: &Row, o: usize) -> rusqlite::Result<MediaAsset> {
    let file_path: String = row.get(o + 2)?;
    let file_exists = Path::new(&file_path).is_file();
    Ok(MediaAsset {
        id: row.get(o)?,
        kind: row.get(o + 1)?,
        file_path,
        original_name: row.get(o + 3)?,
        mime_type: row.get(o + 4)?,
        size_bytes: row.get(o + 5)?,
        width: row.get(o + 6)?,
        height: row.get(o + 7)?,
        duration_ms: row.get(o + 8)?,
        fps: row.get(o + 9)?,
        video_codec: row.get(o + 10)?,
        audio_codec: row.get(o + 11)?,
        has_audio: row.get::<_, Option<i64>>(o + 12)?.map(|v| v != 0),
        thumbnail_path: row.get(o + 13)?,
        parent_id: row.get(o + 14)?,
        character_id: row.get(o + 15)?,
        production_id: row.get(o + 16)?,
        label: row.get(o + 17)?,
        caption: row.get(o + 18)?,
        sort_order: row.get(o + 19)?,
        created_at: row.get(o + 20)?,
        file_exists,
    })
}

#[derive(Debug, Clone, Default)]
pub struct NewAsset {
    pub kind: String,
    pub file_path: String,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub has_audio: Option<bool>,
    pub thumbnail_path: Option<String>,
    pub parent_id: Option<String>,
    pub character_id: Option<String>,
    pub production_id: Option<String>,
    pub label: String,
    pub caption: String,
    pub sort_order: i64,
}

pub fn insert(conn: &Connection, a: &NewAsset) -> AppResult<MediaAsset> {
    let id = new_id();
    conn.execute(
        "INSERT INTO media_assets (id, kind, file_path, original_name, mime_type, size_bytes, sha256,
            width, height, duration_ms, fps, video_codec, audio_codec, has_audio, thumbnail_path,
            parent_id, character_id, production_id, label, caption, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            id,
            a.kind,
            a.file_path,
            a.original_name,
            a.mime_type,
            a.size_bytes,
            a.sha256,
            a.width,
            a.height,
            a.duration_ms,
            a.fps,
            a.video_codec,
            a.audio_codec,
            a.has_audio.map(|b| b as i64),
            a.thumbnail_path,
            a.parent_id,
            a.character_id,
            a.production_id,
            a.label,
            a.caption,
            a.sort_order,
            now(),
        ],
    )?;
    get(conn, &id)?.ok_or_else(|| AppError::not_found("Média introuvable après insertion."))
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<MediaAsset>> {
    let sql = format!("SELECT {} FROM media_assets m WHERE m.id = ?1", asset_columns("m"));
    Ok(conn.query_row(&sql, params![id], |r| row_to_asset(r, 0)).optional()?)
}

pub fn require(conn: &Connection, id: &str) -> AppResult<MediaAsset> {
    get(conn, id)?.ok_or_else(|| AppError::not_found("Ce média n'existe plus."))
}

pub fn list(conn: &Connection, kind: Option<&str>, query: Option<&str>) -> AppResult<Vec<MediaItem>> {
    let like = query
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| format!("%{}%", q.replace('%', "").replace('_', "")));
    let sql = format!(
        "SELECT {}, c.name, p.title, cl.clip_number
         FROM media_assets m
         LEFT JOIN characters c ON c.id = m.character_id
         LEFT JOIN productions p ON p.id = m.production_id
         LEFT JOIN clips cl ON cl.video_asset_id = m.id
         WHERE (?1 IS NULL OR m.kind = ?1)
           AND (?2 IS NULL OR m.original_name LIKE ?2 OR c.name LIKE ?2 OR p.title LIKE ?2 OR m.label LIKE ?2)
         ORDER BY m.created_at DESC",
        asset_columns("m")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![kind, like], |r| {
        Ok(MediaItem {
            asset: row_to_asset(r, 0)?,
            character_name: r.get(ASSET_COLUMN_COUNT)?,
            production_title: r.get(ASSET_COLUMN_COUNT + 1)?,
            clip_number: r.get(ASSET_COLUMN_COUNT + 2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn update_label(conn: &Connection, id: &str, label: &str, caption: &str) -> AppResult<MediaAsset> {
    let changed = conn.execute(
        "UPDATE media_assets SET label = ?2, caption = ?3 WHERE id = ?1",
        params![id, label, caption],
    )?;
    if changed == 0 {
        return Err(AppError::not_found("Ce média n'existe plus."));
    }
    require(conn, id)
}

/// Supprime un media, ses miniatures et les fichiers geres associes.
/// Les rendus finaux exportes hors de l'espace de travail restent sur le disque.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let asset = require(conn, id)?;

    let mut stmt = conn.prepare("SELECT id, file_path FROM media_assets WHERE parent_id = ?1")?;
    let children: Vec<(String, String)> = stmt
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    conn.execute(
        "UPDATE clips SET video_asset_id = NULL, video_imported_at = NULL, updated_at = ?2 WHERE video_asset_id = ?1",
        params![id, now()],
    )?;
    conn.execute("UPDATE characters SET cover_image_id = NULL WHERE cover_image_id = ?1", params![id])?;
    conn.execute(
        "UPDATE productions SET final_video_id = NULL, rendered_at = NULL,
            status = CASE WHEN status = 'rendered' THEN 'generated' ELSE status END
         WHERE final_video_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM media_assets WHERE parent_id = ?1", params![id])?;
    conn.execute("DELETE FROM media_assets WHERE id = ?1", params![id])?;

    for (_, path) in children {
        remove_file_if_unreferenced(conn, &path)?;
    }
    if let Some(thumb) = &asset.thumbnail_path {
        remove_file_if_unreferenced(conn, thumb)?;
    }
    if asset.kind != "render" {
        remove_file_if_unreferenced(conn, &asset.file_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn insert_list_and_delete_with_thumbnail() {
        let conn = db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("v.mp4");
        let thumb = dir.path().join("t.jpg");
        std::fs::write(&video, b"v").unwrap();
        std::fs::write(&thumb, b"t").unwrap();

        let asset = insert(
            &conn,
            &NewAsset {
                kind: "clip_video".into(),
                file_path: video.to_string_lossy().into(),
                original_name: "clip1.mp4".into(),
                thumbnail_path: Some(thumb.to_string_lossy().into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(asset.file_exists);
        assert_eq!(list(&conn, Some("clip_video"), None).unwrap().len(), 1);
        assert_eq!(list(&conn, None, Some("clip1")).unwrap().len(), 1);
        assert_eq!(list(&conn, None, Some("absent")).unwrap().len(), 0);

        delete(&conn, &asset.id).unwrap();
        assert!(get(&conn, &asset.id).unwrap().is_none());
        assert!(!video.exists());
        assert!(!thumb.exists());
    }

    #[test]
    fn deleting_render_keeps_exported_file() {
        let conn = db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("final.mp4");
        std::fs::write(&out, b"mp4").unwrap();
        let asset = insert(
            &conn,
            &NewAsset {
                kind: "render".into(),
                file_path: out.to_string_lossy().into(),
                original_name: "final.mp4".into(),
                ..Default::default()
            },
        )
        .unwrap();
        delete(&conn, &asset.id).unwrap();
        assert!(out.exists());
    }
}
