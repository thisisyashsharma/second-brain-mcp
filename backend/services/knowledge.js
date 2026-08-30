import pool from "../db.js";

// ── Search constants ─────────────────────────────────────────────────────
export const TOP_K_CONCEPTS = 5;
export const TOP_K_DOCUMENTS = 5;
export const MAX_DOCUMENT_CONTEXT_CHARS = 4000;
export const MAX_TOTAL_CONTEXT_CHARS = 15000;

const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","could",
  "should","shall","can","may","might","must","to","of","in",
  "for","on","with","at","by","from","as","into","about",
  "between","through","during","before","after","above","below",
  "and","but","or","nor","not","so","yet","both","either",
  "neither","each","every","all","any","few","more","most",
  "other","some","such","no","only","own","same","than","too",
  "very","just","because","if","when","where","how","what",
  "which","who","whom","this","that","these","those","it","its",
  "i","me","my","we","our","you","your","he","him","his",
  "she","her","they","them","their",
]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function extractKeywords(query) {
  return normalize(query).split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

export function extractPhrases(query) {
  const words = extractKeywords(query);
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) phrases.push(words[i] + " " + words[i + 1]);
  for (let i = 0; i < words.length - 2; i++) phrases.push(words[i] + " " + words[i + 1] + " " + words[i + 2]);
  return phrases;
}

function countWord(text, word) {
  const r = new RegExp("\\b" + escapeRegex(word) + "\\b", "gi");
  return (text.match(r) || []).length;
}

function countPhrase(text, phrase) {
  let c = 0, i = 0;
  while ((i = text.indexOf(phrase, i)) !== -1) { c++; i += phrase.length; }
  return c;
}

export function scoreText(text, boostText, keywords, phrases) {
  const nt = normalize(text || "");
  const nb = normalize(boostText || "");
  let score = 0;

  for (const kw of keywords) {
    score += Math.min(countWord(nt, kw), 10);        // content: 1x (capped at 10)
    score += countWord(nb, kw) * 50;                // boost field: 50x
  }
  for (const ph of phrases) {
    score += Math.min(countPhrase(nt, ph), 5) * 8;  // phrase in content: 8x (capped at 5)
    score += countPhrase(nb, ph) * 80;              // phrase in title/boost: 80x
  }
  return score;
}

export function safeTruncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  return text.slice(0, maxLen) + "\n...(truncated)";
}

const FINANCIAL_TERMS = [
  "financial statements",
  "balance sheet",
  "statement of profit and loss",
  "cash flow statement",
  "notes to accounts",
  "borrowings",
  "revenue",
  "total assets",
  "total liabilities",
  "profit/(loss)",
  "profit / (loss)",
  "financial highlights"
];

export function getBestExcerpt(text, keywords, phrases) {
  if (!text) return "";
  const allTerms = [...keywords, ...phrases].filter(k => k.length > 2);
  if (allTerms.length === 0) return text.substring(0, 2000).trim();

  const regexPattern = allTerms.map(escapeRegex).join('|');
  const regex = new RegExp(regexPattern, 'gi');
  
  let match;
  const windows = [];
  let matchCount = 0;
  
  while ((match = regex.exec(text)) !== null && matchCount < 100) {
    const targetIdx = match.index;
    
    let start = Math.max(0, targetIdx - 300);
    let end = Math.min(text.length, targetIdx + 1200);
    
    const prevNewline = text.lastIndexOf('\n', targetIdx);
    if (prevNewline !== -1 && prevNewline >= start) {
      start = prevNewline + 1;
    } else {
      const nextSpace = text.indexOf(' ', start);
      if (nextSpace !== -1 && nextSpace < targetIdx) start = nextSpace + 1;
    }

    const nextNewline = text.indexOf('\n', end);
    if (nextNewline !== -1 && nextNewline - end < 300) {
      end = nextNewline;
    } else {
      const prevSpace = text.lastIndexOf(' ', end);
      if (prevSpace !== -1 && prevSpace > targetIdx) end = prevSpace;
    }
    
    let excerpt = text.substring(start, end).trim();
    let score = 0;
    const lowerExcerpt = excerpt.toLowerCase();
    
    for (const term of allTerms) {
      const termRegex = new RegExp(escapeRegex(term), 'gi');
      const matches = excerpt.match(termRegex);
      if (matches) score += matches.length * (term.includes(' ') ? 2 : 1);
    }
    
    for (const term of FINANCIAL_TERMS) {
      if (lowerExcerpt.includes(term)) {
        score += 10;
      }
    }
    
    windows.push({ excerpt, score, index: match.index });
    matchCount++;
  }
  
  if (windows.length === 0) return text.substring(0, 1500).trim();
  
  windows.sort((a, b) => b.score - a.score || a.index - b.index);
  return windows[0].excerpt;
}

export async function searchKnowledge(query, allowedTiers = [3]) {
  const keywords = extractKeywords(query);
  const phrases = extractPhrases(query);

  if (keywords.length === 0) {
    return { scoredConcepts: [], scoredDocs: [], scoredSections: [], scoredTables: [], keywords, phrases };
  }

  // Concepts: Assume public/Tier 3 for legacy concepts unless specified
  const conceptsResult = await pool.query("SELECT id, name, slug, summary, content FROM wiki_concepts");
  const scoredConcepts = conceptsResult.rows
    .map((c) => ({
      ...c,
      score: scoreText((c.summary || "") + " " + (c.content || ""), c.name + " " + c.slug, keywords, phrases),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_CONCEPTS);

  const ilikeKeywords = keywords.map(kw => `%${kw}%`);

  // Legacy Documents: Default to Tier 1 since they lack granular sections
  let docsResult = { rows: [] };
  if (allowedTiers.includes(1)) {
    docsResult = await pool.query(`
      SELECT id, filename, filepath, filetype, content
      FROM documents
      WHERE content ILIKE ANY($1)
    `, [ilikeKeywords]);
  }

  const scoredDocs = docsResult.rows
    .map((d) => ({
      ...d,
      score: scoreText(d.content || "", d.filepath + " " + d.filename, keywords, phrases),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_DOCUMENTS)
    .map((d) => ({
      ...d,
      content: getBestExcerpt(d.content || "", keywords, phrases)
    }));

  // Document Sections
  const sectionsResult = await pool.query(`
    SELECT ds.id, ds.section_title, ds.tier, ds.content, d.filename, d.filepath
    FROM document_sections ds
    JOIN documents d ON d.id = ds.document_id
    WHERE ds.tier = ANY($1) AND (ds.content ILIKE ANY($2) OR ds.section_title ILIKE ANY($2))
  `, [allowedTiers, ilikeKeywords]);

  const scoredSections = sectionsResult.rows
    .map((s) => ({
      ...s,
      score: scoreText(s.content || "", s.section_title + " " + s.filename, keywords, phrases),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_DOCUMENTS)
    .map((s) => ({
      ...s,
      content: getBestExcerpt(s.content || "", keywords, phrases)
    }));
    
  // Document Tables
  const tablesResult = await pool.query(`
    SELECT dt.id, dt.table_title, dt.tier, dt.headers, dt.rows, d.filename, ds.section_title
    FROM document_tables dt
    JOIN documents d ON d.id = dt.document_id
    LEFT JOIN document_sections ds ON ds.id = dt.section_id
    WHERE dt.tier = ANY($1) AND (ds.section_title ILIKE ANY($2) OR dt.table_title ILIKE ANY($2) OR dt.headers::text ILIKE ANY($2) OR dt.rows::text ILIKE ANY($2))
  `, [allowedTiers, ilikeKeywords]);
  
  const scoredTables = tablesResult.rows
    .map((t) => ({
      ...t,
      score: scoreText(JSON.stringify(t.rows) + " " + JSON.stringify(t.headers), (t.section_title || "") + " " + t.table_title + " " + t.filename, keywords, phrases),
    }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { scoredConcepts, scoredDocs, scoredSections, scoredTables, keywords, phrases };
}

/**
 * Get full concept details including sources and relationships by name.
 */
export async function getConceptByName(name) {
  const conceptResult = await pool.query(
    "SELECT * FROM wiki_concepts WHERE name ILIKE $1 OR slug = $1",
    [name]
  );
  if (conceptResult.rows.length === 0) return null;
  const concept = conceptResult.rows[0];

  const relResult = await pool.query(
    `SELECT
       wr.relationship,
       CASE WHEN wr.source_concept_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
       c.id, c.name, c.slug, c.summary
     FROM wiki_relationships wr
     JOIN wiki_concepts c
       ON c.id = CASE WHEN wr.source_concept_id = $1 THEN wr.target_concept_id ELSE wr.source_concept_id END
     WHERE wr.source_concept_id = $1 OR wr.target_concept_id = $1`,
    [concept.id]
  );

  const srcResult = await pool.query(
    `SELECT d.id, d.filename, d.filepath, d.filetype, ws.relationship_type
       FROM wiki_sources ws
       JOIN documents d ON d.id = ws.document_id
      WHERE ws.concept_id = $1
      ORDER BY d.filepath`,
    [concept.id]
  );

  return { concept, relationships: relResult.rows, sources: srcResult.rows };
}

/**
 * Get just the relationships for a concept.
 */
export async function getRelatedConcepts(name) {
  const conceptResult = await pool.query(
    "SELECT id FROM wiki_concepts WHERE name ILIKE $1 OR slug = $1",
    [name]
  );
  if (conceptResult.rows.length === 0) return null;
  const conceptId = conceptResult.rows[0].id;

  const relResult = await pool.query(
    `SELECT
       wr.relationship,
       CASE WHEN wr.source_concept_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
       c.name, c.slug, c.summary
     FROM wiki_relationships wr
     JOIN wiki_concepts c
       ON c.id = CASE WHEN wr.source_concept_id = $1 THEN wr.target_concept_id ELSE wr.source_concept_id END
     WHERE wr.source_concept_id = $1 OR wr.target_concept_id = $1`,
    [conceptId]
  );
  return relResult.rows;
}

/**
 * Get a raw document by its path.
 */
export async function getDocumentByPath(path) {
  const docsResult = await pool.query(
    "SELECT filename, filepath, filetype, content FROM documents WHERE filepath = $1",
    [path]
  );
  if (docsResult.rows.length === 0) return null;
  return docsResult.rows[0];
}
