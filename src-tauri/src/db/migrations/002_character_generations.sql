-- Fiche personnage simplifiee et identite generee par Gemini.
-- Aucune colonne existante n'est modifiee ni supprimee : les personnages deja
-- enregistres gardent toutes leurs informations et restent "termines".

ALTER TABLE characters ADD COLUMN status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready'));
ALTER TABLE characters ADD COLUMN active_generation_id TEXT NULL;

-- Une ligne par version generee. Le contenu est valide cote frontend par Zod
-- avant ecriture, comme les histoires.
CREATE TABLE character_generations (
    id           TEXT PRIMARY KEY,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    instruction  TEXT NOT NULL DEFAULT '',
    model        TEXT NOT NULL DEFAULT '',
    brief        TEXT NOT NULL DEFAULT '{}',
    identity     TEXT NOT NULL DEFAULT '{}',
    prompts      TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (character_id, version)
);

CREATE INDEX idx_character_generations_character ON character_generations(character_id);
