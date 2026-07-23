-- Addressable list blocks and exact-first wiki fragments. Markdown remains the
-- durable source; every row here is rebuilt by the normal projection pipeline.
CREATE TABLE blocks (
  note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  pos_from INTEGER NOT NULL,
  pos_to INTEGER NOT NULL,
  block_id TEXT,
  text TEXT NOT NULL,
  markdown TEXT NOT NULL,
  breadcrumbs TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (note_path, ordinal)
);
CREATE INDEX blocks_note_id ON blocks(note_path, block_id) WHERE block_id IS NOT NULL;
CREATE INDEX blocks_path_pos ON blocks(note_path, pos_from);

CREATE VIRTUAL TABLE blocks_fts USING fts5(
  note_path UNINDEXED,
  ordinal UNINDEXED,
  text,
  context,
  note_title
);

ALTER TABLE links ADD COLUMN target_base_key TEXT;
ALTER TABLE links ADD COLUMN fragment_kind TEXT
  CHECK (fragment_kind IN ('heading', 'block') OR fragment_kind IS NULL);
ALTER TABLE links ADD COLUMN fragment_value TEXT;
ALTER TABLE links ADD COLUMN wiki_syntax TEXT
  CHECK (wiki_syntax IN ('reference', 'embed') OR wiki_syntax IS NULL);
CREATE INDEX links_target_base_key ON links(target_base_key);

CREATE VIEW block_keys AS
  SELECT
    note_path,
    block_id,
    count(*) AS claim_count,
    CASE WHEN count(*) = 1 THEN min(ordinal) END AS ordinal,
    CASE WHEN count(*) = 1 THEN min(pos_from) END AS pos_from,
    CASE WHEN count(*) = 1 THEN min(pos_to) END AS pos_to
  FROM blocks
  WHERE block_id IS NOT NULL
  GROUP BY note_path, block_id;

DROP VIEW backlinks;
CREATE VIEW backlinks AS
  -- Exact full-target resolution always wins, including titles containing '#'.
  SELECT
    exact.note_path AS target_path,
    l.source_path,
    l.kind,
    l.target_raw,
    l.alias,
    l.pos_from,
    l.pos_to,
    l.wiki_syntax,
    NULL AS fragment_kind,
    NULL AS fragment_value
  FROM links l
  JOIN note_keys exact ON exact.key = l.target_key
  JOIN notes source ON source.path = l.source_path AND source.kind != 'template'
  WHERE l.kind = 'wiki'

  UNION ALL

  -- Only a full-target miss may fall back to base note + fragment.
  SELECT
    base.note_path AS target_path,
    l.source_path,
    l.kind,
    l.target_raw,
    l.alias,
    l.pos_from,
    l.pos_to,
    l.wiki_syntax,
    l.fragment_kind,
    l.fragment_value
  FROM links l
  JOIN note_keys base ON base.key = l.target_base_key
  JOIN notes source ON source.path = l.source_path AND source.kind != 'template'
  WHERE l.kind = 'wiki'
    AND l.fragment_kind IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM note_keys exact WHERE exact.key = l.target_key);

CREATE VIEW block_backlinks AS
  SELECT
    b.target_path,
    b.source_path,
    b.target_raw,
    b.alias,
    b.pos_from,
    b.pos_to,
    b.wiki_syntax,
    b.fragment_value AS block_id,
    k.claim_count,
    k.ordinal AS target_ordinal,
    k.pos_from AS target_pos_from,
    k.pos_to AS target_pos_to
  FROM backlinks b
  JOIN block_keys k
    ON k.note_path = b.target_path
   AND k.block_id = b.fragment_value
   AND k.claim_count = 1
  WHERE b.fragment_kind = 'block';

CREATE VIEW block_embed_places AS
  SELECT
    b.target_path,
    b.source_path,
    b.target_raw,
    b.alias,
    b.pos_from,
    b.pos_to,
    b.block_id,
    b.target_ordinal,
    (
      SELECT count(*)
      FROM links prior
      WHERE prior.source_path = b.source_path
        AND prior.kind = 'wiki'
        AND prior.wiki_syntax = 'embed'
        AND prior.pos_from < b.pos_from
    ) AS embed_ordinal
  FROM block_backlinks b
  WHERE b.wiki_syntax = 'embed';
