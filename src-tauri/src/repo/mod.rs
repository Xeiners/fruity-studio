//! Couche d'acces aux donnees (requetes SQLite typees).

pub mod characters;
pub mod media;
pub mod productions;

use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::DashboardStats;

pub fn dashboard_stats(conn: &Connection) -> AppResult<DashboardStats> {
    Ok(conn.query_row(
        "SELECT
            (SELECT COUNT(*) FROM characters WHERE archived = 0),
            (SELECT COUNT(*) FROM characters WHERE archived = 1),
            (SELECT COUNT(*) FROM productions),
            (SELECT COUNT(*) FROM productions WHERE status = 'rendered'),
            (SELECT COUNT(*) FROM productions WHERE status <> 'rendered'),
            (SELECT COUNT(*) FROM media_assets WHERE kind = 'character_image'),
            (SELECT COUNT(*) FROM clips WHERE video_asset_id IS NOT NULL)",
        [],
        |r| {
            Ok(DashboardStats {
                characters: r.get(0)?,
                archived_characters: r.get(1)?,
                productions: r.get(2)?,
                completed_videos: r.get(3)?,
                draft_productions: r.get(4)?,
                reference_images: r.get(5)?,
                imported_clips: r.get(6)?,
            })
        },
    )?)
}
