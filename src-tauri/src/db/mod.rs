//! Acces SQLite : ouverture, pragmas et migrations versionnees (`PRAGMA user_version`).

use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::AppResult;

/// Migrations appliquees dans l'ordre. Ne jamais modifier une migration publiee :
/// en ajouter une nouvelle a la fin.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_initial.sql"),
    include_str!("migrations/002_character_generations.sql"),
];

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let version = (index + 1) as i64;
        if version <= current {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let conn = open_in_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        // Une seconde passe ne doit rien reappliquer.
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    /// Un personnage cree avant la fiche simplifiee ne doit rien perdre.
    #[test]
    fn migration_keeps_existing_characters() {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO characters (id, name, species, personality, behavior, voice, mannerisms, appearance,
                distinctive_details, creative_notes, created_at, updated_at)
             VALUES ('old', 'Pomme', 'Pomme rouge', 'Diva', 'Complote', 'Aiguë', 'Soupire', 'Ronde et brillante',
                'Tache dorée', 'Ne gagne jamais', 'a', 'b')",
            [],
        )
        .unwrap();

        migrate(&conn).unwrap();

        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let character = crate::repo::characters::require(&conn, "old").unwrap();
        assert_eq!(character.status, "ready");
        assert_eq!(character.active_generation_id, None);
        assert_eq!(character.behavior, "Complote");
        assert_eq!(character.mannerisms, "Soupire");
        assert_eq!(character.appearance, "Ronde et brillante");
        assert_eq!(character.distinctive_details, "Tache dorée");
        assert_eq!(character.creative_notes, "Ne gagne jamais");
    }
}
