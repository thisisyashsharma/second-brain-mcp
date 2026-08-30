import { searchKnowledge } from "../../backend/services/knowledge.js";

async function run() {
  const queries = [
    "revenue",
    "borrowings",
    "cash flow",
    "total assets",
    "total liabilities",
    "profit",
    "Zomato Annual Report 2022 revenue",
    "operating activities"
  ];
  
  for (const q of queries) {
    console.log(`\n\n=== QUERY: ${q} ===`);
    try {
      const res = await searchKnowledge(q, [1, 2, 3]);
      for (const d of res.scoredDocs) {
        console.log(`[DOC] ${d.filename}`);
        console.log(`[EXCERPT]\n${d.content}\n`);
      }
      for (const s of res.scoredSections || []) {
        console.log(`[SECTION] ${s.section_title} [Tier ${s.tier}] (${s.filename})`);
      }
      for (const t of res.scoredTables || []) {
        console.log(`[TABLE] ${t.table_title} [Tier ${t.tier}] Section: ${t.section_title} (${t.filename})`);
        console.log(`[HEADERS]\n${JSON.stringify(t.headers)}`);
        console.log(`[ROWS]\n${JSON.stringify(t.rows)}\n`);
      }
    } catch (e) {
      console.error(e);
    }
  }
  process.exit(0);
}

run();
