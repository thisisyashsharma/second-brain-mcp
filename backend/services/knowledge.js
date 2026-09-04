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

  // Concepts & Entities: Enforce security tier filtering
  const conceptsResult = await pool.query(
    "SELECT id, name, slug, summary, content, type, tier, metadata FROM wiki_concepts WHERE tier = ANY($1)",
    [allowedTiers]
  );
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

  // Document Sections (Fast indexed candidates)
  const sectionsResult = await pool.query(`
    SELECT ds.id, ds.section_title, ds.tier, ds.content, d.filename, d.filepath
    FROM document_sections ds
    JOIN documents d ON d.id = ds.document_id
    WHERE ds.tier = ANY($1) AND (ds.section_title ILIKE ANY($2) OR ds.content ILIKE ANY($2))
    ORDER BY 
      CASE WHEN ds.section_title ILIKE ANY($2) THEN 1 ELSE 2 END,
      ds.id ASC
    LIMIT 30
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
    
  // Document Tables (Fast candidate matching on country/indicator titles)
  const tablesResult = await pool.query(`
    SELECT dt.id, dt.table_title, dt.tier, dt.headers, dt.rows, d.filename, ds.section_title
    FROM document_tables dt
    JOIN documents d ON d.id = dt.document_id
    LEFT JOIN document_sections ds ON ds.id = dt.section_id
    WHERE dt.tier = ANY($1) AND (ds.section_title ILIKE ANY($2) OR dt.table_title ILIKE ANY($2))
    ORDER BY dt.id ASC
    LIMIT 30
  `, [allowedTiers, ilikeKeywords]);
  
  const scoredTables = tablesResult.rows
    .map((t) => ({
      ...t,
      score: scoreText((t.section_title || "") + " " + t.table_title, (t.section_title || "") + " " + t.table_title + " " + t.filename, keywords, phrases),
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

// ── ADVANCED REASONING & ANALYTICAL SERVICES ─────────────────────────────

function slugify(text) {
  return (text || "").toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "") || "concept-" + Date.now();
}

/**
 * 1. List indexed countries, economic indicators, and document entities.
 */
export async function listEconomicIndicatorsAndEntities({ type = "all", filter = "", allowedTiers = [1, 2, 3] } = {}) {
  const filterClause = filter ? `%${filter}%` : null;
  
  let countries = [];
  let indicators = [];
  let documents = [];

  if (type === "all" || type === "countries") {
    const q = filterClause
      ? `SELECT DISTINCT substring(section_title from 'World Bank: ([^-]+) -') as country 
         FROM document_sections 
         WHERE section_title LIKE 'World Bank:%' AND section_title ILIKE $1 AND tier = ANY($2)
         ORDER BY country NULLS LAST LIMIT 100`
      : `SELECT DISTINCT substring(section_title from 'World Bank: ([^-]+) -') as country 
         FROM document_sections 
         WHERE section_title LIKE 'World Bank:%' AND tier = ANY($1)
         ORDER BY country NULLS LAST LIMIT 100`;
    const res = await pool.query(q, filterClause ? [filterClause, allowedTiers] : [allowedTiers]);
    countries = res.rows.map(r => r.country).filter(Boolean);
  }

  if (type === "all" || type === "indicators") {
    const q = filterClause
      ? `SELECT DISTINCT substring(section_title from ' - (.*)') as indicator 
         FROM document_sections 
         WHERE section_title LIKE '% - %' AND section_title ILIKE $1 AND tier = ANY($2)
         ORDER BY indicator NULLS LAST LIMIT 100`
      : `SELECT DISTINCT substring(section_title from ' - (.*)') as indicator 
         FROM document_sections 
         WHERE section_title LIKE '% - %' AND tier = ANY($1)
         ORDER BY indicator NULLS LAST LIMIT 100`;
    const res = await pool.query(q, filterClause ? [filterClause, allowedTiers] : [allowedTiers]);
    indicators = res.rows.map(r => r.indicator).filter(Boolean);
  }

  if (type === "all" || type === "documents") {
    const q = filterClause
      ? `SELECT id, filename, filepath, filetype, created_at FROM documents WHERE (filename ILIKE $1 OR filepath ILIKE $1) AND 1 = ANY($2) LIMIT 50`
      : `SELECT id, filename, filepath, filetype, created_at FROM documents WHERE 1 = ANY($1) LIMIT 50`;
    const res = await pool.query(q, filterClause ? [filterClause, allowedTiers] : [allowedTiers]);
    documents = res.rows;
  }

  const statsRes = await pool.query(`
    SELECT 
      (SELECT count(*) FROM document_sections) as total_sections,
      (SELECT count(*) FROM document_tables) as total_tables,
      (SELECT count(*) FROM wiki_concepts) as total_concepts
  `);

  return {
    type,
    filter: filter || null,
    stats: statsRes.rows[0],
    countries: countries.length > 0 ? countries : undefined,
    indicators: indicators.length > 0 ? indicators : undefined,
    documents: documents.length > 0 ? documents : undefined,
  };
}

/**
 * 2. Get document outline / Table of Contents with section tiers.
 */
export async function getDocumentTocAndSections({ documentId, filepath, allowedTiers = [1, 2, 3] } = {}) {
  let docQuery = "SELECT id, filename, filepath, filetype FROM documents ";
  let docParams = [];

  if (documentId) {
    docQuery += "WHERE id = $1";
    docParams = [documentId];
  } else if (filepath) {
    docQuery += "WHERE filepath = $1";
    docParams = [filepath];
  } else {
    docQuery += "ORDER BY id LIMIT 1";
  }

  const docRes = await pool.query(docQuery, docParams);
  if (docRes.rows.length === 0) return null;
  const doc = docRes.rows[0];

  const sectionsRes = await pool.query(`
    SELECT ds.id, ds.section_title, ds.tier, ds.start_page, ds.end_page, ds.ordering_index,
           COUNT(dt.id) AS table_count
    FROM document_sections ds
    LEFT JOIN document_tables dt ON dt.section_id = ds.id
    WHERE ds.document_id = $1 AND ds.tier = ANY($2)
    GROUP BY ds.id
    ORDER BY ds.start_page ASC, ds.ordering_index ASC, ds.id ASC
  `, [doc.id, allowedTiers]);

  return {
    document: doc,
    total_sections: sectionsRes.rows.length,
    allowed_tiers: allowedTiers,
    sections: sectionsRes.rows,
  };
}

/**
 * 3. Extract clean time-series metric data with analytical calculations (YoY change, min, max, CAGR).
 */
export async function getIndicatorTimeseries({ country, indicator, startYear, endYear, allowedTiers = [1, 2, 3] }) {
  if (!country || !indicator) {
    throw new Error("Both country and indicator are required");
  }

  const ilikeCountry = `%${country}%`;
  const ilikeIndicator = `%${indicator}%`;

  const tablesRes = await pool.query(`
    SELECT dt.id, dt.table_title, dt.tier, dt.headers, dt.rows, d.filename, ds.section_title
    FROM document_tables dt
    JOIN documents d ON d.id = dt.document_id
    LEFT JOIN document_sections ds ON ds.id = dt.section_id
    WHERE dt.tier = ANY($1)
      AND (
        (dt.table_title ILIKE $2 OR dt.rows::text ILIKE $2 OR ds.section_title ILIKE $2)
        AND
        (dt.table_title ILIKE $3 OR dt.headers::text ILIKE $3 OR dt.rows::text ILIKE $3 OR ds.section_title ILIKE $3)
      )
    LIMIT 10
  `, [allowedTiers, ilikeCountry, ilikeIndicator]);

  if (tablesRes.rows.length === 0) {
    return { found: false, message: `No tables found for country '${country}' and indicator '${indicator}' within allowed tiers.` };
  }

  const sYear = startYear ? parseInt(startYear) : 1900;
  const eYear = endYear ? parseInt(endYear) : 2100;

  const timeseries = [];
  let countryMatch = "";
  let indicatorMatch = "";

  for (const t of tablesRes.rows) {
    const headers = Array.isArray(t.headers) ? t.headers : [];
    const rows = Array.isArray(t.rows) ? t.rows : [];

    const countryIdx = headers.findIndex(h => /country/i.test(h) && !/code/i.test(h));
    const indicatorIdx = headers.findIndex(h => /indicator/i.test(h) && !/code/i.test(h));
    const yearIdx = headers.findIndex(h => /year/i.test(h));
    const valIdx = headers.findIndex(h => /value/i.test(h) || /amount/i.test(h));

    for (const row of rows) {
      if (!Array.isArray(row)) continue;

      const rCountry = countryIdx !== -1 ? row[countryIdx] : "";
      const rIndicator = indicatorIdx !== -1 ? row[indicatorIdx] : "";
      const rYearStr = yearIdx !== -1 ? row[yearIdx] : "";
      const rValStr = valIdx !== -1 ? row[valIdx] : "";

      const rowText = row.join(" ");
      const matchesCountry = rCountry ? rCountry.toLowerCase().includes(country.toLowerCase()) : rowText.toLowerCase().includes(country.toLowerCase());
      const matchesIndicator = rIndicator ? rIndicator.toLowerCase().includes(indicator.toLowerCase()) : rowText.toLowerCase().includes(indicator.toLowerCase());

      if (matchesCountry && matchesIndicator) {
        if (!countryMatch && rCountry) countryMatch = rCountry;
        if (!indicatorMatch && rIndicator) indicatorMatch = rIndicator;

        const year = parseInt(rYearStr);
        const val = parseFloat(rValStr);

        if (!isNaN(year) && !isNaN(val) && year >= sYear && year <= eYear) {
          timeseries.push({ year, value: val });
        }
      }
    }
  }

  // Deduplicate and sort by year
  const uniqueByYear = new Map();
  timeseries.forEach(pt => uniqueByYear.set(pt.year, pt.value));
  const sortedPoints = Array.from(uniqueByYear.entries())
    .map(([year, value]) => ({ year, value }))
    .sort((a, b) => a.year - b.year);

  if (sortedPoints.length === 0) {
    return {
      found: false,
      message: `Table matches found, but no valid year-value data points in range ${sYear}-${eYear}.`,
      raw_matched_tables: tablesRes.rows.map(t => t.table_title),
    };
  }

  // Analytical Calculations
  const values = sortedPoints.map(p => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const minPoint = sortedPoints.find(p => p.value === minVal);
  const maxPoint = sortedPoints.find(p => p.value === maxVal);
  const earliestPoint = sortedPoints[0];
  const latestPoint = sortedPoints[sortedPoints.length - 1];

  const absoluteChange = latestPoint.value - earliestPoint.value;
  const percentageChange = earliestPoint.value !== 0
    ? ((absoluteChange / earliestPoint.value) * 100).toFixed(2) + "%"
    : "N/A";

  const numYears = latestPoint.year - earliestPoint.year;
  let cagr = "N/A";
  if (numYears > 0 && earliestPoint.value > 0 && latestPoint.value > 0) {
    cagr = (((Math.pow(latestPoint.value / earliestPoint.value, 1 / numYears)) - 1) * 100).toFixed(2) + "%";
  }

  return {
    found: true,
    country: countryMatch || country,
    indicator: indicatorMatch || indicator,
    data_points_count: sortedPoints.length,
    time_range: `${earliestPoint.year} - ${latestPoint.year}`,
    analytics: {
      earliest: earliestPoint,
      latest: latestPoint,
      min: minPoint,
      max: maxPoint,
      absolute_change: absoluteChange,
      percentage_change: percentageChange,
      compound_annual_growth_rate: cagr,
    },
    timeseries: sortedPoints,
  };
}

/**
 * 4. Multi-country comparative benchmarking.
 */
export async function compareCountryMetrics({ countries = [], indicator, year, startYear, endYear, allowedTiers = [1, 2, 3] }) {
  if (!indicator) throw new Error("Indicator is required");
  const countryList = Array.isArray(countries) ? countries : countries.split(",").map(c => c.trim()).filter(Boolean);
  if (countryList.length === 0) throw new Error("At least one country is required");

  const results = [];

  for (const c of countryList) {
    try {
      const ts = await getIndicatorTimeseries({
        country: c,
        indicator,
        startYear: year || startYear,
        endYear: year || endYear,
        allowedTiers,
      });

      if (ts.found) {
        results.push({
          country: ts.country,
          found: true,
          time_range: ts.time_range,
          analytics: ts.analytics,
          recent_value: ts.analytics.latest.value,
          recent_year: ts.analytics.latest.year,
        });
      } else {
        results.push({ country: c, found: false, message: ts.message });
      }
    } catch (e) {
      results.push({ country: c, found: false, error: e.message });
    }
  }

  // Sort found countries by latest value descending for ranking
  const ranked = results
    .filter(r => r.found)
    .sort((a, b) => (b.recent_value || 0) - (a.recent_value || 0));

  return {
    indicator,
    compared_count: countryList.length,
    ranking_by_latest_value: ranked.map((r, idx) => ({
      rank: idx + 1,
      country: r.country,
      year: r.recent_year,
      value: r.recent_value,
      pct_change: r.analytics?.percentage_change,
      cagr: r.analytics?.compound_annual_growth_rate,
    })),
    detailed_comparisons: results,
  };
}

/**
 * 5. Cross-reference macroeconomic factors with micro/corporate financial sections.
 */
export async function crossReferenceMacroWithMicro({ macroQuery, microQuery, allowedTiers = [1, 2, 3] }) {
  if (!macroQuery || !microQuery) {
    throw new Error("Both macroQuery and microQuery are required");
  }

  const macroKeywords = extractKeywords(macroQuery);
  const microKeywords = extractKeywords(microQuery);

  const macroRes = await searchKnowledge(macroQuery, allowedTiers);
  const microRes = await searchKnowledge(microQuery, allowedTiers);

  return {
    macro_context: {
      query: macroQuery,
      sections: (macroRes.scoredSections || []).slice(0, 3).map(s => ({
        title: s.section_title,
        tier: s.tier,
        document: s.filename,
        excerpt: s.content,
      })),
      tables: (macroRes.scoredTables || []).slice(0, 2).map(t => ({
        title: t.table_title,
        tier: t.tier,
        headers: t.headers,
        sample_rows: (t.rows || []).slice(0, 5),
      })),
    },
    micro_context: {
      query: microQuery,
      sections: (microRes.scoredSections || []).slice(0, 3).map(s => ({
        title: s.section_title,
        tier: s.tier,
        document: s.filename,
        excerpt: s.content,
      })),
      tables: (microRes.scoredTables || []).slice(0, 2).map(t => ({
        title: t.table_title,
        tier: t.tier,
        headers: t.headers,
        sample_rows: (t.rows || []).slice(0, 5),
      })),
    },
    synthesis_guidance: "Use macro_context indicators (e.g. inflation, debt trends) to evaluate financial impacts, cost structures, and risk factors in micro_context.",
  };
}

/**
 * 6. Dynamic On-Demand Statistical Correlation Engine (Pearson r, R^2, and trend alignment)
 */
export async function computeDynamicCorrelation({ country, indicatorA, indicatorB, startYear, endYear, allowedTiers = [1, 2, 3] }) {
  if (!country || !indicatorA || !indicatorB) {
    throw new Error("country, indicatorA, and indicatorB are required");
  }

  // 1. Resolve Indicators and their security tiers
  const indQuery = `
    SELECT ds.tier, ds.section_title
    FROM document_sections ds
    WHERE ds.section_title ILIKE $1 AND ds.section_title ILIKE $2
    ORDER BY 
      CASE 
        WHEN substring(ds.section_title from ' - (.*)') ILIKE $3 THEN 1
        WHEN substring(ds.section_title from ' - (.*)') ILIKE $4 THEN 2
        ELSE 3
      END ASC,
      ds.id ASC
    LIMIT 1
  `;

  const findIndA = await pool.query(indQuery, [`%${country}%`, `%${indicatorA}%`, indicatorA, `${indicatorA}%`]);
  const findIndB = await pool.query(indQuery, [`%${country}%`, `%${indicatorB}%`, indicatorB, `${indicatorB}%`]);

  if (findIndA.rows.length === 0) {
    return { found: false, message: `No data found for country '${country}' and indicator '${indicatorA}'.` };
  }
  if (findIndB.rows.length === 0) {
    return { found: false, message: `No data found for country '${country}' and indicator '${indicatorB}'.` };
  }

  const tierA = findIndA.rows[0].tier;
  const tierB = findIndB.rows[0].tier;
  const fullTitleA = findIndA.rows[0].section_title;
  const fullTitleB = findIndB.rows[0].section_title;

  // 2. Strict Security Tier Gate
  if (!allowedTiers.includes(tierA)) {
    return {
      found: false,
      security_blocked: true,
      restricted_indicator: indicatorA,
      required_tier: tierA,
      message: `Access Denied: Indicator '${indicatorA}' is classified as Tier ${tierA} and is restricted from your access level.`
    };
  }
  if (!allowedTiers.includes(tierB)) {
    return {
      found: false,
      security_blocked: true,
      restricted_indicator: indicatorB,
      required_tier: tierB,
      message: `Access Denied: Indicator '${indicatorB}' is classified as Tier ${tierB} and is restricted from your access level.`
    };
  }

  // 3. Fetch Timeseries from tables
  const seriesA = await getIndicatorTimeseries({ country, indicator: indicatorA, startYear, endYear, allowedTiers });
  const seriesB = await getIndicatorTimeseries({ country, indicator: indicatorB, startYear, endYear, allowedTiers });

  if (!seriesA.found || !seriesB.found) {
    return { found: false, message: "Could not retrieve time-series for both indicators to compute correlation." };
  }

  // 4. Align by overlapping year
  const mapA = new Map((seriesA.timeseries || []).map(p => [p.year, p.value]));
  const mapB = new Map((seriesB.timeseries || []).map(p => [p.year, p.value]));

  const alignedYears = [];
  const xVals = [];
  const yVals = [];
  const alignedPairs = [];

  for (const [yr, valA] of mapA.entries()) {
    if (mapB.has(yr)) {
      const valB = mapB.get(yr);
      if (valA !== null && valB !== null && !isNaN(valA) && !isNaN(valB)) {
        alignedYears.push(yr);
        xVals.push(valA);
        yVals.push(valB);
        alignedPairs.push({ year: yr, [indicatorA]: valA, [indicatorB]: valB });
      }
    }
  }

  alignedPairs.sort((a, b) => a.year - b.year);

  const n = xVals.length;
  if (n < 3) {
    return {
      found: true,
      country,
      indicatorA: fullTitleA,
      indicatorB: fullTitleB,
      sample_size: n,
      message: `Insufficient overlapping observation years (${n} years found). At least 3 overlapping years are required for statistical correlation.`
    };
  }

  // 5. Compute Pearson Correlation Coefficient (r)
  const meanX = xVals.reduce((acc, v) => acc + v, 0) / n;
  const meanY = yVals.reduce((acc, v) => acc + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xVals[i] - meanX;
    const dy = yVals[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const denominator = Math.sqrt(denX * denY);
  const r = denominator === 0 ? 0 : num / denominator;
  const rSquared = r * r;

  let relationshipType = "Weak / No Linear Correlation";
  if (r >= 0.80) relationshipType = "Strong Positive Correlation";
  else if (r >= 0.50) relationshipType = "Moderate Positive Correlation";
  else if (r <= -0.80) relationshipType = "Strong Inverse Correlation";
  else if (r <= -0.50) relationshipType = "Moderate Inverse Correlation";

  let interpretation = "";
  if (r >= 0.70) {
    interpretation = `As ${indicatorA} increased in ${country}, ${indicatorB} demonstrated strong upward co-movement (Pearson r = ${r.toFixed(3)}).`;
  } else if (r <= -0.70) {
    interpretation = `There is an inverse relationship: increases in ${indicatorA} correspond with systematic decreases in ${indicatorB} in ${country} (Pearson r = ${r.toFixed(3)}).`;
  } else {
    interpretation = `No dominant linear co-movement observed between ${indicatorA} and ${indicatorB} (Pearson r = ${r.toFixed(3)}).`;
  }

  const formattedSummary = `### Statistical Correlation Analysis: ${country}
* **Pearson r**: ${r.toFixed(4)}
* **Coefficient of Determination (R²)**: ${rSquared.toFixed(4)}
* **Sample Size**: ${n} overlapping observation years (${Math.min(...alignedYears)}–${Math.max(...alignedYears)})
* **Relationship Type**: "${relationshipType}"
* **Economic Reasoning**: ${interpretation}`;

  return {
    found: true,
    country,
    indicatorA: fullTitleA,
    indicatorB: fullTitleB,
    security_tier: Math.max(tierA, tierB),
    sample_size_years: n,
    time_range: { start_year: Math.min(...alignedYears), end_year: Math.max(...alignedYears) },
    statistics: {
      pearson_correlation_coefficient: parseFloat(r.toFixed(4)),
      coefficient_of_determination_r2: parseFloat(rSquared.toFixed(4)),
      relationship_type: relationshipType,
    },
    interpretation,
    formatted_summary: formattedSummary,
    aligned_observations: alignedPairs,
  };
}

/**
 * 7. Native PostgreSQL Recursive CTE Multi-Hop Graph Traversal with Cycle Prevention
 */
export async function traceConceptGraph({ conceptName, depth = 2, allowedTiers = [1, 2, 3] }) {
  if (!conceptName) throw new Error("conceptName is required");
  const maxDepth = Math.min(Math.max(parseInt(depth) || 1, 1), 4);

  const query = `
    WITH RECURSIVE graph_cte AS (
      -- Base Case: Root concept/entity
      SELECT 
        c.id, c.name, c.slug, c.type, c.tier, c.summary, c.metadata,
        NULL::INTEGER AS parent_id,
        NULL::TEXT AS relationship,
        NULL::INTEGER AS relationship_tier,
        1 AS depth,
        ARRAY[c.id] AS path
      FROM wiki_concepts c
      WHERE (c.name ILIKE $1 OR c.slug = $1) AND c.tier = ANY($2)

      UNION ALL

      -- Recursive Step: Multi-hop traversal with cycle prevention and tier gating
      SELECT 
        next_c.id, next_c.name, next_c.slug, next_c.type, next_c.tier, next_c.summary, next_c.metadata,
        prev.id AS parent_id,
        wr.relationship,
        wr.tier AS relationship_tier,
        prev.depth + 1 AS depth,
        prev.path || next_c.id AS path
      FROM graph_cte prev
      JOIN wiki_relationships wr ON (wr.source_concept_id = prev.id OR wr.target_concept_id = prev.id)
      JOIN wiki_concepts next_c ON next_c.id = (
        CASE WHEN wr.source_concept_id = prev.id THEN wr.target_concept_id ELSE wr.source_concept_id END
      )
      WHERE prev.depth < $3
        AND wr.tier = ANY($2)
        AND next_c.tier = ANY($2)
        AND NOT (next_c.id = ANY(prev.path)) -- Cycle prevention
    )
    SELECT * FROM graph_cte ORDER BY depth, id;
  `;

  const res = await pool.query(query, [`%${conceptName}%`, allowedTiers, maxDepth]);

  if (res.rows.length === 0) {
    return {
      root_concept: conceptName,
      depth: maxDepth,
      allowed_tiers: allowedTiers,
      total_nodes: 0,
      total_edges: 0,
      nodes: [],
      edges: [],
      message: `No accessible concepts or entities found for '${conceptName}' in security tiers [${allowedTiers.join(', ')}].`
    };
  }

  const nodeMap = new Map();
  const edges = [];

  for (const r of res.rows) {
    if (!nodeMap.has(r.id)) {
      nodeMap.set(r.id, {
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        tier: r.tier,
        summary: r.summary,
        metadata: r.metadata,
        depth: r.depth,
      });
    }

    if (r.parent_id && r.relationship) {
      const edgeKey = `${r.parent_id}-${r.relationship}-${r.id}`;
      if (!edges.some(e => e.key === edgeKey)) {
        const parent = nodeMap.get(r.parent_id);
        edges.push({
          key: edgeKey,
          source: parent ? parent.name : `ID:${r.parent_id}`,
          target: r.name,
          relationship: r.relationship,
          tier: r.relationship_tier,
        });
      }
    }
  }

  return {
    root_concept: conceptName,
    depth: maxDepth,
    allowed_tiers: allowedTiers,
    total_nodes: nodeMap.size,
    total_edges: edges.length,
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

/**
 * 8. Entity Dossier Generator (Entity Profile, Linked Concepts, and Tiered Indicators)
 */
export async function getEntityDossier({ country, allowedTiers = [1, 2, 3] }) {
  if (!country) throw new Error("country is required");

  // 1. Fetch Entity Node
  const entityRes = await pool.query(`
    SELECT id, name, slug, type, tier, summary, content, metadata
    FROM wiki_concepts
    WHERE (name ILIKE $1 OR slug ILIKE $2) AND type = 'entity'
    LIMIT 1
  `, [`%${country}%`, `%entity-${country.toLowerCase().replace(/[^a-z0-9]/g, '')}%`]);

  if (entityRes.rows.length === 0) {
    return { found: false, message: `Entity '${country}' not found in the Second Brain database.` };
  }

  const entity = entityRes.rows[0];

  // 2. Fetch Linked Concepts via Recursive Graph Traversal
  const graph = await traceConceptGraph({ conceptName: entity.name, depth: 2, allowedTiers });

  // 3. Fetch Available Indicators and Sections for this Entity
  const sectionsRes = await pool.query(`
    SELECT ds.id, ds.section_title, ds.tier, count(dt.id) as table_count
    FROM document_sections ds
    LEFT JOIN document_tables dt ON dt.section_id = ds.id
    WHERE ds.section_title ILIKE $1 AND ds.tier = ANY($2)
    GROUP BY ds.id
    ORDER BY ds.tier ASC, ds.section_title ASC
  `, [`%${entity.name}%`, allowedTiers]);

  const indicatorsByTier = { 1: [], 2: [], 3: [] };
  for (const s of sectionsRes.rows) {
    const indicatorName = s.section_title.replace(`World Bank: ${entity.name} - `, '').trim();
    if (indicatorsByTier[s.tier]) {
      indicatorsByTier[s.tier].push({ section_id: s.id, indicator: indicatorName, tables: parseInt(s.table_count) });
    }
  }

  return {
    found: true,
    entity: {
      name: entity.name,
      slug: entity.slug,
      country_code: entity.metadata?.country_code || 'N/A',
      summary: entity.summary,
    },
    allowed_tiers: allowedTiers,
    linked_macro_concepts: graph.nodes.filter(n => n.type === 'concept'),
    graph_relationships: graph.edges,
    indexed_indicators_by_tier: {
      tier_1_sensitive: indicatorsByTier[1],
      tier_2_operational: indicatorsByTier[2],
      tier_3_public: indicatorsByTier[3],
    },
    total_accessible_indicators: sectionsRes.rows.length,
  };
}

/**
 * 7. Multi-tier discrepancy and provenance auditing.
 */
export async function auditMetricDiscrepancy({ entity, metric, allowedTiers = [1, 2, 3] }) {
  const query = `${entity || ""} ${metric || ""}`.trim();
  if (!query) throw new Error("Entity or metric is required");

  const keywords = extractKeywords(query);
  const ilikeKeywords = keywords.map(kw => `%${kw}%`);

  const sectionsRes = await pool.query(`
    SELECT ds.id, ds.section_title, ds.tier, ds.content, ds.start_page, ds.end_page, d.filename
    FROM document_sections ds
    JOIN documents d ON d.id = ds.document_id
    WHERE ds.tier = ANY($1) AND (ds.content ILIKE ANY($2) OR ds.section_title ILIKE ANY($2))
    ORDER BY ds.tier ASC, ds.id ASC
    LIMIT 20
  `, [allowedTiers, ilikeKeywords]);

  const tablesRes = await pool.query(`
    SELECT dt.id, dt.table_title, dt.tier, dt.page, dt.headers, dt.rows, d.filename
    FROM document_tables dt
    JOIN documents d ON d.id = dt.document_id
    WHERE dt.tier = ANY($1) AND (dt.table_title ILIKE ANY($2) OR dt.headers::text ILIKE ANY($2) OR dt.rows::text ILIKE ANY($2))
    ORDER BY dt.tier ASC, dt.id ASC
    LIMIT 10
  `, [allowedTiers, ilikeKeywords]);

  // Group by Tier
  const tierBreakdown = {
    tier1_audited_financials: { sections: [], tables: [] },
    tier2_operational_estimates: { sections: [], tables: [] },
    tier3_public_governance: { sections: [], tables: [] },
  };

  sectionsRes.rows.forEach(s => {
    const item = { id: s.id, title: s.section_title, tier: s.tier, document: s.filename, page_range: `${s.start_page}-${s.end_page}`, excerpt: getBestExcerpt(s.content, keywords, []) };
    if (s.tier === 1) tierBreakdown.tier1_audited_financials.sections.push(item);
    else if (s.tier === 2) tierBreakdown.tier2_operational_estimates.sections.push(item);
    else tierBreakdown.tier3_public_governance.sections.push(item);
  });

  tablesRes.rows.forEach(t => {
    const item = { id: t.id, title: t.table_title, tier: t.tier, document: t.filename, page: t.page, headers: t.headers, sample_rows: (t.rows || []).slice(0, 3) };
    if (t.tier === 1) tierBreakdown.tier1_audited_financials.tables.push(item);
    else if (t.tier === 2) tierBreakdown.tier2_operational_estimates.tables.push(item);
    else tierBreakdown.tier3_public_governance.tables.push(item);
  });

  return {
    audited_entity: entity || "General",
    audited_metric: metric || query,
    total_findings: sectionsRes.rows.length + tablesRes.rows.length,
    tier_breakdown: tierBreakdown,
    audit_notes: "Compare numbers in Tier 1 against Tier 2/3 to identify reporting discrepancies or variance between audited statements and public presentations.",
  };
}

/**
 * 8. Save Claude's analytical brief into PostgreSQL wiki_concepts & sources.
 */
export async function saveAnalyticalBrief({ title, slug, summary, content, relatedConcepts = [], sourceDocumentPaths = [] }) {
  if (!title || !content) {
    throw new Error("Both title and content are required");
  }

  const finalSlug = slug ? slugify(slug) : slugify(title);

  // Upsert Concept
  const conceptRes = await pool.query(`
    INSERT INTO wiki_concepts (name, slug, summary, content, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, summary = EXCLUDED.summary, content = EXCLUDED.content, updated_at = NOW()
    RETURNING id, name, slug, summary, created_at, updated_at
  `, [title, finalSlug, summary || "", content]);

  const concept = conceptRes.rows[0];

  // Link Sources
  let sourcesLinked = 0;
  for (const docPath of sourceDocumentPaths) {
    const docRes = await pool.query("SELECT id FROM documents WHERE filepath = $1 OR filename = $1", [docPath]);
    if (docRes.rows.length > 0) {
      await pool.query(`
        INSERT INTO wiki_sources (concept_id, document_id, relationship_type)
        VALUES ($1, $2, 'analysis_source')
        ON CONFLICT (concept_id, document_id) DO NOTHING
      `, [concept.id, docRes.rows[0].id]);
      sourcesLinked++;
    }
  }

  // Link Related Concepts
  let relationshipsCreated = 0;
  for (const rel of relatedConcepts) {
    const targetName = typeof rel === "string" ? rel : rel.target_name;
    const relationshipType = typeof rel === "string" ? "relates_to" : (rel.relationship || "relates_to");

    const targetRes = await pool.query("SELECT id FROM wiki_concepts WHERE name ILIKE $1 OR slug = $1", [targetName]);
    if (targetRes.rows.length > 0) {
      const targetId = targetRes.rows[0].id;
      if (targetId !== concept.id) {
        await pool.query(`
          INSERT INTO wiki_relationships (source_concept_id, target_concept_id, relationship)
          VALUES ($1, $2, $3)
          ON CONFLICT (source_concept_id, target_concept_id, relationship) DO NOTHING
        `, [concept.id, targetId, relationshipType]);
        relationshipsCreated++;
      }
    }
  }

  return {
    success: true,
    concept_id: concept.id,
    name: concept.name,
    slug: concept.slug,
    summary: concept.summary,
    sources_linked: sourcesLinked,
    relationships_created: relationshipsCreated,
    message: `Analytical brief '${concept.name}' saved to Second Brain knowledge graph.`,
  };
}
