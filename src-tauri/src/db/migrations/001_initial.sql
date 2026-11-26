-- Fruity Studio : schema initial.
-- Les dates sont stockees en ISO 8601 UTC. Les contenus generes par Gemini sont
-- stockes en JSON (valides cote frontend par Zod avant ecriture).

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE characters (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    species             TEXT NOT NULL DEFAULT '',
    short_description   TEXT NOT NULL DEFAULT '',
    personality         TEXT NOT NULL DEFAULT '',
    behavior            TEXT NOT NULL DEFAULT '',
    voice               TEXT NOT NULL DEFAULT '',
    mannerisms          TEXT NOT NULL DEFAULT '',
    appearance          TEXT NOT NULL DEFAULT '',
    distinctive_details TEXT NOT NULL DEFAULT '',
    creative_notes      TEXT NOT NULL DEFAULT '',
    color               TEXT NOT NULL DEFAULT '#B7F36B',
    cover_image_id      TEXT NULL,
    archived            INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX idx_characters_archived ON characters(archived);

CREATE TABLE character_relationships (
    id                   TEXT PRIMARY KEY,
    character_id         TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    related_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    relation             TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL,
    UNIQUE (character_id, related_character_id)
);

CREATE TABLE productions (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'rendered')),
    synopsis         TEXT NOT NULL DEFAULT '',
    target_duration  INTEGER NOT NULL DEFAULT 30,
    clip_duration    INTEGER NOT NULL DEFAULT 10,
    params           TEXT NOT NULL DEFAULT '{}',
    story            TEXT NOT NULL DEFAULT '{}',
    render_settings  TEXT NOT NULL DEFAULT '{}',
    final_video_id   TEXT NULL,
    rendered_at      TEXT NULL,
    thumbnail_path   TEXT NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX idx_productions_updated ON productions(updated_at);

CREATE TABLE production_characters (
    production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (production_id, character_id)
);

CREATE TABLE media_assets (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('character_image', 'clip_video', 'render', 'music', 'sfx', 'thumbnail')),
    file_path     TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT '',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT NULL,
    width         INTEGER NULL,
    height        INTEGER NULL,
    duration_ms   INTEGER NULL,
    fps           REAL NULL,
    video_codec   TEXT NULL,
    audio_codec   TEXT NULL,
    has_audio     INTEGER NULL,
    thumbnail_path TEXT NULL,
    parent_id     TEXT NULL,
    character_id  TEXT NULL REFERENCES characters(id) ON DELETE SET NULL,
    production_id TEXT NULL REFERENCES productions(id) ON DELETE SET NULL,
    label         TEXT NOT NULL DEFAULT '',
    caption       TEXT NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE INDEX idx_media_kind ON media_assets(kind);
CREATE INDEX idx_media_character ON media_assets(character_id);
CREATE INDEX idx_media_production ON media_assets(production_id);
CREATE INDEX idx_media_sha ON media_assets(sha256);
CREATE INDEX idx_media_parent ON media_assets(parent_id);

CREATE TABLE clips (
    id                TEXT PRIMARY KEY,
    production_id     TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    clip_number       INTEGER NOT NULL,
    duration          INTEGER NOT NULL,
    content           TEXT NOT NULL DEFAULT '{}',
    flow_prompt       TEXT NOT NULL DEFAULT '',
    prompt_edited     INTEGER NOT NULL DEFAULT 0,
    video_asset_id    TEXT NULL REFERENCES media_assets(id) ON DELETE SET NULL,
    video_imported_at TEXT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (production_id, clip_number)
);

CREATE INDEX idx_clips_production ON clips(production_id);
