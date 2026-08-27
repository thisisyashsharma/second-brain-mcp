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
    score += countWord(nt, kw);          // content: 1x
    score += countWord(nb, kw) * 10;     // boost field: 10x
  }
  for (const ph of phrases) {
    score += countPhrase(nt, ph) * 8;    // phrase: 8x
  }
  return score;
}

export function safeTruncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  return text.slice(0, maxLen) + "\n...(truncated)";
}

/**
 * Searches wiki concepts and raw documents using the keyword scoring logic.
 * Returns scored and sorted top concepts and documents.
 */
export async function searchKnowledge(query) {
  const keywords = extractKeywords(query);
  const phrases = extractPhrases(query);

  if (keywords.length === 0) {
    return { scoredConcepts: [], scoredDocs: [], keywords, phrases };
  }

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
  const regexPattern = keywords.map(escapeRegex).join('|');

  const docsResult = await pool.query(`
    SELECT id, filename, filepath, filetype, 
           SUBSTRING(content FROM GREATEST(1, regexp_instr(content, $2, 1, 1, 0, 'i') - 500) FOR 4000) AS content
    FROM documents
    WHERE content ILIKE ANY($1)
  `, [ilikeKeywords, regexPattern]);

  const scoredDocs = docsResult.rows
    .map((d) => ({
      ...d,
      score: scoreText(d.content || "", d.filepath + " " + d.filename, keywords, phrases),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_DOCUMENTS);

  return { scoredConcepts, scoredDocs, keywords, phrases };
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
