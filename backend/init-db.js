import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function init() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
    await pool.query(sql);
    console.log("✅ Database schema initialized successfully");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
