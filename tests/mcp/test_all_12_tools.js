import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import 'dotenv/config';
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, "../../backend");
const TEST_PORT = 4006;

async function waitForServer(port) {
  const url = `http://localhost:${port}/api/health`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time.");
}

async function runDetailedSuite() {
  console.log("=========================================================================");
  console.log("   🧪 RUNNING COMPLETE LIVE TEST OF ALL 12 MCP TOOLS IN SECOND BRAIN   ");
  console.log("=========================================================================\n");

  const env = { ...process.env, PORT: TEST_PORT.toString(), MCP_ALLOWED_TIERS: "1,2,3" };
  const serverProc = spawn("node", ["server.js"], { env, cwd: BACKEND_DIR, stdio: "pipe" });

  serverProc.stderr.on("data", data => console.error("[Server Error]", data.toString()));

  try {
    await waitForServer(TEST_PORT);
    console.log(`✅ Backend server started successfully on http://localhost:${TEST_PORT}\n`);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${TEST_PORT}/mcp`)
    );

    const client = new Client({ name: "comprehensive-tester", version: "2.0.0" }, { capabilities: {} });
    await client.connect(transport);
    console.log("✅ Streamable HTTP Transport connected. Ready to test.\n");

    const toolsList = await client.listTools();
    console.log(`📋 Total Registered Tools in Schema: ${toolsList.tools.length}\n`);

    let passedCount = 0;

    async function testTool(num, name, args, validator) {
      console.log(`-------------------------------------------------------------------------`);
      console.log(`🛠️  TOOL ${num}/12: [${name}]`);
      console.log(`📥 Input Args: ${JSON.stringify(args)}`);
      const start = Date.now();
      try {
        const res = await client.callTool({ name, arguments: args });
        const elapsed = Date.now() - start;
        const text = res.content[0].text;
        
        let preview = text;
        try {
          const parsed = JSON.parse(text);
          preview = JSON.stringify(parsed, null, 2);
        } catch {}

        if (preview.length > 400) {
          console.log(`📤 Output (${elapsed}ms):\n${preview.slice(0, 400)}\n... [truncated for display, total length: ${preview.length} chars]`);
        } else {
          console.log(`📤 Output (${elapsed}ms):\n${preview}`);
        }

        if (validator) {
          validator(text);
        }
        console.log(`\n✅ RESULT: PASS (${elapsed}ms)`);
        passedCount++;
      } catch (err) {
        console.error(`\n❌ RESULT: FAILED - ${err.message}`);
      }
      console.log(`-------------------------------------------------------------------------\n`);
    }

    // Pre-create base concept to ensure relationships can be formed
    await client.callTool({
      name: "save_analytical_brief",
      arguments: {
        title: "Debt Sustainability",
        summary: "Assessment of sovereign debt repayment capability.",
        content: "Core concept analyzing national debt-to-GDP and external vulnerability."
      }
    });

    // 1. list_economic_indicators_and_entities
    await testTool(1, "list_economic_indicators_and_entities", { type: "all", filter: "Debt" }, (text) => {
      const data = JSON.parse(text);
      if (!data.stats || !data.indicators) throw new Error("Missing stats or indicators");
    });

    // 2. get_document_toc_and_sections
    await testTool(2, "get_document_toc_and_sections", {}, (text) => {
      const data = JSON.parse(text);
      if (!data.document || data.total_sections === 0) throw new Error("No sections returned");
    });

    // 3. search_knowledge
    await testTool(3, "search_knowledge", { query: "External debt stocks Angola" }, (text) => {
      if (!text.includes("Angola") && !text.includes("External debt")) throw new Error("Search results missing expected keywords");
    });

    // 4. save_analytical_brief
    await testTool(4, "save_analytical_brief", {
      title: "Macroeconomic Assessment of South Asia 2024",
      summary: "Macro risk and debt sustainability profile for South Asian economies.",
      content: "## Overview\nSouth Asian external debt increased over the last decade.\n\n### Metrics\n- Sustained capital inflow challenges",
      sourceDocumentPaths: ["imported/worldbank_data.csv"],
      relatedConcepts: ["Debt Sustainability"]
    }, (text) => {
      const data = JSON.parse(text);
      if (!data.success || !data.concept_id) throw new Error("Failed to save analytical brief");
    });

    // 5. get_concept
    await testTool(5, "get_concept", { name: "Macroeconomic Assessment of South Asia 2024" }, (text) => {
      if (!text.includes("Macroeconomic Assessment") || !text.includes("Overview")) throw new Error("Concept not found");
    });

    // 6. get_related_concepts
    await testTool(6, "get_related_concepts", { name: "Macroeconomic Assessment of South Asia 2024" }, (text) => {
      if (!text.includes("Debt Sustainability")) throw new Error("Relationships missing");
    });

    // 7. get_document
    await testTool(7, "get_document", { path: "imported/worldbank_data.csv" }, (text) => {
      if (!text.includes("Document:") && !text.includes("imported/worldbank_data.csv")) throw new Error("Document content not retrieved");
    });

    // 8. get_indicator_timeseries
    await testTool(8, "get_indicator_timeseries", {
      country: "Angola",
      indicator: "External debt",
      startYear: 2005,
      endYear: 2020
    }, (text) => {
      const data = JSON.parse(text);
      if (!data.found || !data.analytics || data.timeseries.length === 0) throw new Error("Timeseries extraction failed");
    });

    // 9. compare_country_metrics
    await testTool(9, "compare_country_metrics", {
      countries: ["Angola", "Argentina", "Albania"],
      indicator: "External debt",
      startYear: 2010,
      endYear: 2020
    }, (text) => {
      const data = JSON.parse(text);
      if (data.ranking_by_latest_value.length < 2) throw new Error("Comparison ranking missing");
    });

    // 10. cross_reference_macro_with_micro
    await testTool(10, "cross_reference_macro_with_micro", {
      macroQuery: "Inflation consumer prices annual",
      microQuery: "External debt borrowings total"
    }, (text) => {
      const data = JSON.parse(text);
      if (!data.macro_context || !data.micro_context) throw new Error("Cross reference contexts missing");
    });

    // 11. trace_concept_graph
    await testTool(11, "trace_concept_graph", {
      conceptName: "Macroeconomic Assessment of South Asia 2024",
      depth: 2
    }, (text) => {
      const data = JSON.parse(text);
      if (data.total_nodes === 0) throw new Error("Graph nodes empty");
    });

    // 12. audit_metric_discrepancy
    await testTool(12, "audit_metric_discrepancy", {
      entity: "World Bank",
      metric: "External debt"
    }, (text) => {
      const data = JSON.parse(text);
      if (!data.tier_breakdown || data.total_findings === 0) throw new Error("Audit findings empty");
    });

    console.log("=========================================================================");
    console.log(`   🏆 FINAL SCORE: ${passedCount}/12 TOOLS PASSED LIVE EXECUTION TESTS!   `);
    console.log("=========================================================================\n");

    await transport.close();
    process.exit(passedCount === 12 ? 0 : 1);
  } finally {
    serverProc.kill();
  }
}

runDetailedSuite().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
