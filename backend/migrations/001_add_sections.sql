CREATE TABLE IF NOT EXISTS document_sections (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_title TEXT,
  tier INTEGER NOT NULL,
  content TEXT,
  start_page INTEGER,
  end_page INTEGER,
  ordering_index INTEGER,
  needs_review BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_tables (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES document_sections(id) ON DELETE CASCADE,
  table_title TEXT,
  tier INTEGER NOT NULL,
  page INTEGER,
  headers JSONB,
  rows JSONB,
  needs_review BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
