import { searchKnowledge } from "./backend/services/knowledge.js";

async function run() {
  const queries = [
    "revenue",
    "borrowings",
    "cash flow",
    "total assets",
    "total liabilities",
    "profit",
    "Zomato Annual Report 2022 revenue"
  ];
  
  for (const q of queries) {
    console.log(`\n\n=== QUERY: ${q} ===`);
    try {
      const res = await searchKnowledge(q);
      for (const d of res.scoredDocs) {
        console.log(`[DOC] ${d.filename}`);
        console.log(`[EXCERPT]\n${d.content}\n`);
      }
    } catch (e) {
      console.error(e);
    }
  }
  process.exit(0);
}

run();
