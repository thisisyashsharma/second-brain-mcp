-- ============================================================
-- Second Brain V2 — Database Schema
-- ============================================================

-- Raw uploaded documents
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL,
  filepath      TEXT NOT NULL,
  filetype      TEXT,
  content       TEXT,
  metadata      JSONB DEFAULT '{}',
  compilation_status TEXT DEFAULT 'pending',
  compilation_error  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Compiled wiki concepts
CREATE TABLE IF NOT EXISTS wiki_concepts (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  summary       TEXT,
  content       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Links concepts to their source documents
CREATE TABLE IF NOT EXISTS wiki_sources (
  id                SERIAL PRIMARY KEY,
  concept_id        INTEGER NOT NULL REFERENCES wiki_concepts(id) ON DELETE CASCADE,
  document_id       INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'derived_from',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(concept_id, document_id)
);

-- Relationships between concepts
CREATE TABLE IF NOT EXISTS wiki_relationships (
  id                  SERIAL PRIMARY KEY,
  source_concept_id   INTEGER NOT NULL REFERENCES wiki_concepts(id) ON DELETE CASCADE,
  target_concept_id   INTEGER NOT NULL REFERENCES wiki_concepts(id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_concept_id, target_concept_id, relationship)
);

-- Document sections (Multi-Tier Security)
CREATE TABLE IF NOT EXISTS document_sections (
  id              SERIAL PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_title   TEXT,
  tier            INTEGER NOT NULL,
  content         TEXT,
  start_page      INTEGER,
  end_page        INTEGER,
  ordering_index  INTEGER,
  needs_review    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Document tables (Multi-Tier Security)
CREATE TABLE IF NOT EXISTS document_tables (
  id              SERIAL PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id      INTEGER REFERENCES document_sections(id) ON DELETE CASCADE,
  table_title     TEXT,
  tier            INTEGER NOT NULL,
  page            INTEGER,
  headers         JSONB,
  rows            JSONB,
  needs_review    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for frequent lookups
CREATE INDEX IF NOT EXISTS idx_documents_filepath       ON documents(filepath);
CREATE INDEX IF NOT EXISTS idx_documents_filename       ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_status         ON documents(compilation_status);
CREATE INDEX IF NOT EXISTS idx_concepts_slug            ON wiki_concepts(slug);
CREATE INDEX IF NOT EXISTS idx_concepts_name            ON wiki_concepts(name);
CREATE INDEX IF NOT EXISTS idx_sources_concept          ON wiki_sources(concept_id);
CREATE INDEX IF NOT EXISTS idx_sources_document         ON wiki_sources(document_id);
CREATE INDEX IF NOT EXISTS idx_relations_source         ON wiki_relationships(source_concept_id);
CREATE INDEX IF NOT EXISTS idx_relations_target         ON wiki_relationships(target_concept_id);
CREATE INDEX IF NOT EXISTS idx_sections_document_id     ON document_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_sections_tier            ON document_sections(tier);
CREATE INDEX IF NOT EXISTS idx_tables_document_id       ON document_tables(document_id);
CREATE INDEX IF NOT EXISTS idx_tables_section_id        ON document_tables(section_id);
CREATE INDEX IF NOT EXISTS idx_tables_tier              ON document_tables(tier);
