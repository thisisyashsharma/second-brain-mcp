import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.DATABASE_URL || "";
const isLocalDb = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
const isRemoteDb = !isLocalDb && (
  dbUrl.includes("render.com") ||
  dbUrl.includes("supabase.co") ||
  dbUrl.includes("neon.tech") ||
  dbUrl.startsWith("postgres://") ||
  dbUrl.startsWith("postgresql://")
);

const enableSsl = Boolean(
  process.env.PGSSLMODE === "require" ||
  (isRemoteDb && !isLocalDb)
);

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: enableSsl ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

export default pool;
