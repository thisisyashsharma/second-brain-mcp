import { searchKnowledge } from "../../backend/services/knowledge.js";

async function runDemo() {
  const testCases = [
    {
      name: "1. SENSITIVE QUERY: 'India External Debt & Military Spending'",
      query: "India External debt military expenditure",
    },
    {
      name: "2. OPERATIONAL QUERY: 'India Unemployment Rate & Electricity Access'",
      query: "India Unemployment electricity access",
    },
    {
      name: "3. PUBLIC QUERY: 'India GDP & Total Population'",
      query: "India GDP Population total",
    }
  ];

  const profiles = [
    { name: "MCP 1 (Admin: Tiers 1, 2, 3)", allowedTiers: [1, 2, 3] },
    { name: "MCP 2 (Operations: Tiers 2, 3)", allowedTiers: [2, 3] },
    { name: "MCP 3 (Public: Tier 3 Only)", allowedTiers: [3] },
  ];

  for (const tc of testCases) {
    console.log("\n" + "=".repeat(70));
    console.log(`TEST CASE: ${tc.name}`);
    console.log("=".repeat(70));

    for (const p of profiles) {
      console.log(`\n>>> [Client Level: ${p.name}]`);
      const res = await searchKnowledge(tc.query, p.allowedTiers);

      if ((!res.scoredSections || res.scoredSections.length === 0) && (!res.scoredTables || res.scoredTables.length === 0)) {
        console.log("    🔒 RESULT: [BLOCKED / ACCESS DENIED - No matching authorized records]");
      } else {
        if (res.scoredSections && res.scoredSections.length > 0) {
          console.log(`    ✅ Sections Found (${res.scoredSections.length}):`);
          for (const s of res.scoredSections.slice(0, 2)) {
            console.log(`       - ${s.section_title} [Tier ${s.tier}]`);
          }
        }
        if (res.scoredTables && res.scoredTables.length > 0) {
          console.log(`    📊 Tables Found (${res.scoredTables.length}):`);
          for (const t of res.scoredTables.slice(0, 1)) {
            console.log(`       - ${t.table_title} [Tier ${t.tier}]`);
            const rows = t.rows || [];
            const sample = rows.slice(-3); // last 3 years
            for (const r of sample) {
              console.log(`         Year ${r[6]}: ${r[7]}`);
            }
          }
        }
      }
    }
  }

  process.exit(0);
}

runDemo();
