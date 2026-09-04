import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./db.js";
import { setupMcpServer } from "./mcp.js";
import { setupOAuthRoutes } from "./oauth.js";
import { getConceptByName } from "./services/knowledge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());

// Set up MCP Server first, so it doesn't get interfered with by body-parser
setupMcpServer(app);

// Setup OAuth 2.0 endpoints with targeted body parsing
app.use("/oauth", express.urlencoded({ extended: true }), express.json());
setupOAuthRoutes(app);

app.use(express.json());

// =====================================================================
// ROUTES
// =====================================================================

// ── Health ────────────────────────────────────────────────────────────

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "error", message: "Database unreachable" });
  }
});

// ── Documents ────────────────────────────────────────────────────────

app.get("/api/documents", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, filepath, filetype, compilation_status, compilation_error,
              length(content) AS content_length, created_at, updated_at
         FROM documents
        ORDER BY created_at DESC`
    );
    res.json({ documents: result.rows });
  } catch (err) {
    console.error("Error listing documents:", err.message);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// ── Wiki Concepts ────────────────────────────────────────────────────

app.get("/api/wiki/concepts", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.slug, c.summary, c.created_at, c.updated_at,
              COUNT(DISTINCT ws.document_id) AS source_count
         FROM wiki_concepts c
         LEFT JOIN wiki_sources ws ON ws.concept_id = c.id
        GROUP BY c.id
        ORDER BY c.name`
    );
    res.json({ concepts: result.rows });
  } catch (err) {
    console.error("Error listing concepts:", err.message);
    res.status(500).json({ error: "Failed to list concepts" });
  }
});

app.get("/api/wiki/concepts/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    const data = await getConceptByName(slug);
    if (!data) {
      return res.status(404).json({ error: "Concept not found" });
    }
    res.json(data);
  } catch (err) {
    console.error("Error fetching concept:", err.message);
    res.status(500).json({ error: "Failed to fetch concept" });
  }
});

// ── Start ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🧠 Second Brain V2 (MCP Mode) running on http://localhost:${PORT}`);
});
