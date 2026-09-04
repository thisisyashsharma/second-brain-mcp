import assert from "node:assert";
import {
  computeDynamicCorrelation,
  traceConceptGraph,
  getEntityDossier,
  searchKnowledge,
} from "../../backend/services/knowledge.js";

async function runTests() {
  console.log("=================================================================");
  console.log("   AUTOMATED VERIFICATION: ENTITIES, CONCEPTS & CORRELATIONS   ");
  console.log("=================================================================\n");

  let passed = 0;
  let total = 0;

  function check(desc, condition) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
    }
  }

  // ── TEST 1: Entity Dossier Retrieval ─────────────────────────────────────
  console.log("--- 1. Testing Entity Dossier ---");
  const indiaDossier = await getEntityDossier({ country: "India", allowedTiers: [1, 2, 3] });
  check("Entity Dossier found for India", indiaDossier.found === true);
  check("Country code is IND", indiaDossier.entity.country_code === "IND");
  check("Total accessible indicators >= 10", indiaDossier.total_accessible_indicators >= 10);
  check("Tier 1 sensitive indicators categorized", indiaDossier.indexed_indicators_by_tier.tier_1_sensitive.length > 0);
  check("Tier 3 public indicators categorized", indiaDossier.indexed_indicators_by_tier.tier_3_public.length > 0);
  check("Linked Macro Concepts present", indiaDossier.linked_macro_concepts.length > 0);

  // ── TEST 2: Dynamic Statistical Pearson Correlation (Allowed Tier 3) ────
  console.log("\n--- 2. Testing Dynamic Statistical Correlation (India Internet vs GDP) ---");
  const corr = await computeDynamicCorrelation({
    country: "India",
    indicatorA: "Internet",
    indicatorB: "GDP",
    allowedTiers: [3],
  });
  check("Correlation computed successfully", corr.found === true);
  check("Sample size >= 4 years", corr.sample_size_years >= 4);
  const r = corr.statistics?.pearson_correlation_coefficient;
  console.log(`       Pearson r: ${r} (${corr.statistics?.relationship_type})`);
  check("Pearson r shows strong positive co-movement (r > 0.90)", r > 0.90);
  check("R^2 coefficient computed (R2 > 0.80)", corr.statistics?.coefficient_of_determination_r2 > 0.80);

  // ── TEST 3: Recursive CTE Multi-Hop Graph Traversal ──────────────────────
  console.log("\n--- 3. Testing Recursive CTE Graph Traversal ---");
  const graph = await traceConceptGraph({
    conceptName: "Universal Electrification",
    depth: 3,
    allowedTiers: [1, 2, 3],
  });
  check("Graph traversal discovered >= 3 nodes", graph.total_nodes >= 3);
  check("Graph traversal discovered >= 2 edges", graph.total_edges >= 2);
  const nodeNames = graph.nodes.map(n => n.name);
  console.log(`       Discovered Nodes: ${nodeNames.join(", ")}`);
  check("Traversed to Digital Economy Transformation", nodeNames.includes("Digital Economy Transformation"));

  // ── TEST 4: Security Barrier Enforcement (Tier 3 client blocked on Tier 1)
  console.log("\n--- 4. Testing Security Barrier Enforcement ---");
  const blockedCorr = await computeDynamicCorrelation({
    country: "India",
    indicatorA: "GDP",
    indicatorB: "External debt",
    allowedTiers: [3], // Tier 3 public only
  });
  check("Tier 1 correlation blocked for Tier 3 user", blockedCorr.security_blocked === true);
  check("Access Denied message returned", (blockedCorr.message || "").includes("Access Denied"));
  console.log(`       Security Guard: ${blockedCorr.message}`);

  const blockedGraph = await traceConceptGraph({
    conceptName: "Sovereign External Debt De-leveraging",
    allowedTiers: [3], // Tier 3 public only
  });
  check("Tier 1 concept hidden from Tier 3 client", blockedGraph.total_nodes === 0);

  // ── TEST 5: Search Knowledge Concepts Integration ────────────────────────
  console.log("\n--- 5. Testing Concepts in search_knowledge ---");
  const searchRes = await searchKnowledge("Electrification infrastructure India", [1, 2, 3]);
  check("searchKnowledge returns concepts", searchRes.scoredConcepts.length > 0);
  console.log(`       Top Concept: ${searchRes.scoredConcepts[0]?.name}`);
  check("Top concept is Universal Electrification", searchRes.scoredConcepts[0]?.name === "Universal Electrification");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(65));
  console.log(`TEST SUMMARY: ${passed} / ${total} assertions passed (${Math.round((passed/total)*100)}%)`);
  console.log("=".repeat(65) + "\n");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
