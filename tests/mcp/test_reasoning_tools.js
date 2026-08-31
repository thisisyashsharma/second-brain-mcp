import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import 'dotenv/config';
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, "../../backend");
const TEST_PORT = 4005;

async function waitForServer(port) {
  const url = `http://localhost:${port}/api/health`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // wait and retry
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time.");
}

async function runSuite() {
  console.log("===============================================================");
  console.log("   🧪 Running Second Brain Advanced Reasoning MCP Tools Suite   ");
  console.log("===============================================================\n");

  const env = { ...process.env, PORT: TEST_PORT.toString(), MCP_ALLOWED_TIERS: "1,2,3" };
  const serverProc = spawn("node", ["server.js"], { env, cwd: BACKEND_DIR, stdio: "pipe" });

  serverProc.stderr.on("data", data => console.error("[Server Error]", data.toString()));

  try {
    await waitForServer(TEST_PORT);
    console.log(`✅ Backend server up and running on port ${TEST_PORT}\n`);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${TEST_PORT}/mcp`)
    );

    const client = new Client({ name: "reasoning-test-client", version: "2.0.0" }, { capabilities: {} });
    await client.connect(transport);
    console.log("✅ MCP Client connected successfully!\n");

    // ── Tool Listing Test ───────────────────────────────────────────
    console.log("── Test 0: Listing All Registered MCP Tools ──");
    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map(t => t.name);
    console.log(`Discovered ${toolNames.length} tools: ${toolNames.join(", ")}`);
    if (toolNames.length < 12) {
      throw new Error(`Expected at least 12 tools, but found ${toolNames.length}`);
    }
    console.log("  => PASS\n");

    // ── Tool 1: list_economic_indicators_and_entities ───────────────
    console.log("── Test 1: list_economic_indicators_and_entities ──");
    const res1 = await client.callTool({
      name: "list_economic_indicators_and_entities",
      arguments: { type: "all", filter: "Debt" },
    });
    const data1 = JSON.parse(res1.content[0].text);
    console.log(`Found indicators with 'Debt':`, data1.indicators);
    console.log(`Stats:`, data1.stats);
    if (!data1.stats || !data1.indicators) throw new Error("Tool 1 failed output structure");
    console.log("  => PASS\n");

    // ── Tool 2: get_document_toc_and_sections ───────────────────────
    console.log("── Test 2: get_document_toc_and_sections ──");
    const res2 = await client.callTool({
      name: "get_document_toc_and_sections",
      arguments: {},
    });
    const data2 = JSON.parse(res2.content[0].text);
    console.log(`Document: ${data2.document.filename} (Total sections: ${data2.total_sections})`);
    console.log(`Sample section: ${data2.sections[0]?.section_title} [Tier ${data2.sections[0]?.tier}]`);
    if (data2.total_sections === 0) throw new Error("Tool 2 returned 0 sections");
    console.log("  => PASS\n");

    // ── Tool 3: get_indicator_timeseries ────────────────────────────
    console.log("── Test 3: get_indicator_timeseries (Angola External Debt) ──");
    const res3 = await client.callTool({
      name: "get_indicator_timeseries",
      arguments: {
        country: "Angola",
        indicator: "External debt",
        startYear: 2000,
        endYear: 2022,
      },
    });
    const data3 = JSON.parse(res3.content[0].text);
    console.log(`Matched: ${data3.country} | Indicator: ${data3.indicator}`);
    console.log(`Time range: ${data3.time_range} (${data3.data_points_count} points)`);
    console.log(`Analytics:`, data3.analytics);
    if (!data3.found || !data3.timeseries || data3.timeseries.length === 0) {
      throw new Error("Tool 3 failed to extract timeseries");
    }
    console.log("  => PASS\n");

    // ── Tool 4: compare_country_metrics ─────────────────────────────
    console.log("── Test 4: compare_country_metrics (Angola vs Argentina External Debt) ──");
    const res4 = await client.callTool({
      name: "compare_country_metrics",
      arguments: {
        countries: ["Angola", "Argentina"],
        indicator: "External debt",
        startYear: 2010,
        endYear: 2020,
      },
    });
    const data4 = JSON.parse(res4.content[0].text);
    console.log(`Ranking:`, data4.ranking_by_latest_value);
    if (data4.ranking_by_latest_value.length === 0) throw new Error("Tool 4 failed to rank countries");
    console.log("  => PASS\n");

    // ── Tool 5: cross_reference_macro_with_micro ────────────────────
    console.log("── Test 5: cross_reference_macro_with_micro ──");
    const res5 = await client.callTool({
      name: "cross_reference_macro_with_micro",
      arguments: {
        macroQuery: "Inflation consumer prices",
        microQuery: "External debt borrowings",
      },
    });
    const data5 = JSON.parse(res5.content[0].text);
    console.log(`Macro sections found: ${data5.macro_context.sections.length}`);
    console.log(`Micro sections found: ${data5.micro_context.sections.length}`);
    console.log("  => PASS\n");

    // ── Tool 6: audit_metric_discrepancy ────────────────────────────
    console.log("── Test 6: audit_metric_discrepancy ──");
    const res6 = await client.callTool({
      name: "audit_metric_discrepancy",
      arguments: {
        entity: "World Bank",
        metric: "External debt",
      },
    });
    const data6 = JSON.parse(res6.content[0].text);
    console.log(`Audited metric: ${data6.audited_metric}`);
    console.log(`Tier 1 sections: ${data6.tier_breakdown.tier1_audited_financials.sections.length}`);
    console.log("  => PASS\n");

    // ── Tool 7: save_analytical_brief ───────────────────────────────
    console.log("── Test 7: save_analytical_brief ──");
    const res7 = await client.callTool({
      name: "save_analytical_brief",
      arguments: {
        title: "Angola Debt Profile & Macro Trends",
        summary: "Analysis of Angola's external debt trajectory from 2000 to 2022.",
        content: "### Executive Summary\nAngola's external debt peaked in 2021 before experiencing slight consolidation.\n\n### Findings\n- 2000 Baseline: $9.76B\n- 2021 Peak: $66.01B\n- 2022 Level: $60.44B",
        sourceDocumentPaths: ["imported/worldbank_data.csv"],
      },
    });
    const data7 = JSON.parse(res7.content[0].text);
    console.log(`Saved Concept: ${data7.name} (ID: ${data7.concept_id}, Sources linked: ${data7.sources_linked})`);
    if (!data7.success) throw new Error("Tool 7 failed to save brief");
    console.log("  => PASS\n");

    // ── Tool 8: trace_concept_graph ─────────────────────────────────
    console.log("── Test 8: trace_concept_graph (retrieving saved brief) ──");
    const res8 = await client.callTool({
      name: "trace_concept_graph",
      arguments: {
        conceptName: "Angola Debt Profile & Macro Trends",
        depth: 2,
      },
    });
    const data8 = JSON.parse(res8.content[0].text);
    console.log(`Concept graph nodes found: ${data8.total_nodes}`);
    if (data8.total_nodes === 0) throw new Error("Tool 8 failed to find concept in graph");
    console.log("  => PASS\n");

    console.log("===============================================================");
    console.log("   🎉 ALL 8 ADVANCED REASONING MCP TOOLS PASSED VERIFICATION!  ");
    console.log("===============================================================\n");

    await transport.close();
  } finally {
    serverProc.kill();
  }
}

runSuite().catch(err => {
  console.error("\n❌ Test Suite Failed:", err);
  process.exit(1);
});
