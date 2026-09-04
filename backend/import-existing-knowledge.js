/**
 * Import local directory knowledge into PostgreSQL.
 *
 * Usage: npm run ingest
 * (Or: node import-existing-knowledge.js)
 */
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getFileType, extractText } from "./services/extractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR 
  ? path.resolve(process.cwd(), process.env.KNOWLEDGE_DIR)
  : path.resolve(__dirname, "..", "knowledge");

const dbUrl = process.env.DATABASE_URL || "";
const isRemoteDb =
  dbUrl.includes("render.com") ||
  dbUrl.includes("supabase.co") ||
  (!dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1") && dbUrl.startsWith("postgres"));

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: isRemoteDb || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function discoverFiles(dir, base = dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`Directory not found: ${dir}`);
      return [];
    }
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverFiles(full, base)));
    } else if (entry.isFile()) {
      // Only include supported files
      if (getFileType(entry.name)) {
        files.push(path.relative(base, full).replace(/\\/g, "/"));
      }
    }
  }
  return files;
}

async function main() {
  console.log(`Scanning knowledge directory: ${KNOWLEDGE_DIR}`);
  const files = await discoverFiles(KNOWLEDGE_DIR);

  if (files.length === 0) {
    console.log("No supported files (md, txt, pdf) found.");
    await pool.end();
    return;
  }

  console.log(`Found ${files.length} file(s) to import:\n`);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const relativePath of files) {
    const filename = path.basename(relativePath);
    const fullPath = path.join(KNOWLEDGE_DIR, relativePath);
    const filetype = getFileType(filename);

    try {
      const stat = await fs.stat(fullPath);
      const mtimeMs = stat.mtimeMs;
      const size = stat.size;
      
      const fileMetadata = { mtimeMs, size, source: "cli-ingest" };

      // Check if already imported
      const existing = await pool.query(
        "SELECT id, metadata FROM documents WHERE filepath = $1",
        [relativePath]
      );

      if (existing.rows.length > 0) {
        const existingMeta = existing.rows[0].metadata || {};
        
        // Skip if modified time and size are identical
        if (existingMeta.mtimeMs === mtimeMs && existingMeta.size === size) {
          console.log(`  ⏭️  ${relativePath} (unchanged, skipping)`);
          skipped++;
          continue;
        }

        // Changed, we need to update
        console.log(`  🔄 ${relativePath} (changed, updating...)`);
        const content = await extractText(fullPath, filetype);

        await pool.query(
          `UPDATE documents 
           SET content = $1, metadata = $2, filetype = $3, updated_at = NOW(), compilation_status = 'pending'
           WHERE id = $4`,
          [content, JSON.stringify(fileMetadata), filetype, existing.rows[0].id]
        );
        updated++;
      } else {
        // New file
        console.log(`  ✅ ${relativePath} (new, importing...)`);
        const content = await extractText(fullPath, filetype);

        await pool.query(
          `INSERT INTO documents (filename, filepath, filetype, content, metadata, compilation_status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [filename, relativePath, filetype, content, JSON.stringify(fileMetadata)]
        );
        imported++;
      }
    } catch (err) {
      console.error(`  ❌ Failed to process ${relativePath}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${updated} updated, ${skipped} skipped, ${failed} failed.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
