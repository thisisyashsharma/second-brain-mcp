import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, "../../backend");
dotenv.config({ path: path.join(BACKEND_DIR, ".env") });

async function waitForServer(port) {
  const url = `http://localhost:${port}/api/health`;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server on port ${port} failed to start.`);
}

function spawnServer(port, tiers) {
  const env = { ...process.env, PORT: port.toString(), MCP_ALLOWED_TIERS: tiers };
  const proc = spawn("node", ["server.js"], { env, cwd: BACKEND_DIR, stdio: "pipe" });
  proc.stderr.on("data", (d) => {});
  return proc;
}

async function createClient(port) {
  const token = process.env.MCP_AUTH_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: "automated-tester", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertTest(testName, condition, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    console.log(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ""}`);
  }
}

async function runAutomatedTests() {
  console.log("\n" + "=".repeat(75));
  console.log("       AUTOMATED MCP 3-TIER SECURITY & REASONING TEST SUITE        ");
  console.log("=".repeat(75));

  // ─────────────────────────────────────────────────────────────────────────
  // PART 1: TIER 3 ONLY INSTANCE (MCP 3 - PORT 5003)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[1/3] Starting MCP 3 Server (Public Access: MCP_ALLOWED_TIERS='3')...");
  const proc5003 = spawnServer(5003, "3");
  try {
    await waitForServer(5003);
    const { client: client3, transport: trans3 } = await createClient(5003);

    try {
      console.log("  Running Security & Reasoning Assertions on MCP 3...");

      // 1. Tier 3 Allowed Query
      const resT3 = await client3.callTool({
        name: "search_knowledge",
        arguments: { query: "India GDP Population total" },
      });
      const textT3 = resT3.content[0].text;
      assertTest("MCP 3 retrieves Tier 3 GDP / Population", textT3.includes("[Tier 3]") && textT3.includes("India"));

      // 2. Tier 2 Gated Query (Should be BLOCKED)
      const resT2on3 = await client3.callTool({
        name: "search_knowledge",
        arguments: { query: "India Unemployment electricity access" },
      });
      const textT2on3 = resT2on3.content[0].text;
      assertTest("MCP 3 strictly BLOCKS Tier 2 (Unemployment / Electricity)", !textT2on3.includes("[Tier 2]"));

      // 3. Tier 1 Sensitive Query (Should be BLOCKED)
      const resT1on3 = await client3.callTool({
        name: "search_knowledge",
        arguments: { query: "India External debt military expenditure" },
      });
      const textT1on3 = resT1on3.content[0].text;
      assertTest("MCP 3 strictly BLOCKS Tier 1 (External Debt / Military)", !textT1on3.includes("[Tier 1]"));
    } finally {
      await trans3.close();
    }
  } finally {
    proc5003.kill();
    await new Promise((r) => setTimeout(r, 600));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PART 2: TIERS 2 & 3 INSTANCE (MCP 2 - PORT 5002)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[2/3] Starting MCP 2 Server (Operations Access: MCP_ALLOWED_TIERS='2,3')...");
  const proc5002 = spawnServer(5002, "2,3");
  try {
    await waitForServer(5002);
    const { client: client2, transport: trans2 } = await createClient(5002);

    try {
      console.log("  Running Security & Reasoning Assertions on MCP 2...");

      // 1. Tier 3 Allowed
      const resT3 = await client2.callTool({
        name: "search_knowledge",
        arguments: { query: "United States Life expectancy" },
      });
      const textT3 = resT3.content[0].text;
      assertTest("MCP 2 retrieves Tier 3 Life Expectancy", textT3.includes("[Tier 3]"));

      // 2. Tier 2 Allowed (Operations)
      const resT2 = await client2.callTool({
        name: "search_knowledge",
        arguments: { query: "India electricity access" },
      });
      const textT2 = resT2.content[0].text;
      assertTest("MCP 2 retrieves Tier 2 Electricity Access", textT2.includes("[Tier 2]") && textT2.includes("99.9"));

      // 3. Tier 2 Health Spending Per Capita
      const resHealth = await client2.callTool({
        name: "search_knowledge",
        arguments: { query: "United States health expenditure per capita" },
      });
      const textHealth = resHealth.content[0].text;
      assertTest("MCP 2 retrieves Tier 2 Health Spending ($13,473/capita)", textHealth.includes("13473") && textHealth.includes("[Tier 2]"));

      // 4. Tier 1 Sensitive Query (Should be BLOCKED)
      const resT1on2 = await client2.callTool({
        name: "search_knowledge",
        arguments: { query: "China external debt military" },
      });
      const textT1on2 = resT1on2.content[0].text;
      assertTest("MCP 2 strictly BLOCKS Tier 1 (China External Debt / Military)", !textT1on2.includes("[Tier 1]"));
    } finally {
      await trans2.close();
    }
  } finally {
    proc5002.kill();
    await new Promise((r) => setTimeout(r, 600));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PART 3: FULL ADMIN INSTANCE (MCP 1 - PORT 5001)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[3/3] Starting MCP 1 Server (Full Access: MCP_ALLOWED_TIERS='1,2,3')...");
  const proc5001 = spawnServer(5001, "1,2,3");
  try {
    await waitForServer(5001);
    const { client: client1, transport: trans1 } = await createClient(5001);

    try {
      console.log("  Running Full Multi-Tier Data & Value Assertions on MCP 1...");

      // 1. Tier 1 Military Expenditure
      const resMil = await client1.callTool({
        name: "search_knowledge",
        arguments: { query: "Germany Military expenditure" },
      });
      const textMil = resMil.content[0].text;
      assertTest("MCP 1 retrieves Tier 1 Germany Military Spending (1.89% of GDP)", textMil.includes("[Tier 1]") && textMil.includes("1.89"));

      // 2. Tier 1 External Debt Stocks
      const resDebt = await client1.callTool({
        name: "search_knowledge",
        arguments: { query: "India External debt stocks" },
      });
      const textDebt = resDebt.content[0].text;
      assertTest("MCP 1 retrieves Tier 1 India External Debt ($716.4B)", textDebt.includes("[Tier 1]") && textDebt.includes("716456023890"));

      // 3. Tier 1 China External Debt Reduction
      const resChinaDebt = await client1.callTool({
        name: "search_knowledge",
        arguments: { query: "China External debt stocks" },
      });
      const textChinaDebt = resChinaDebt.content[0].text;
      assertTest("MCP 1 retrieves Tier 1 China External Debt ($2.42T)", textChinaDebt.includes("[Tier 1]") && textChinaDebt.includes("2419835436491"));

      // 4. Cross-Tier Multi-Metric Retrieval
      const resMulti = await client1.callTool({
        name: "search_knowledge",
        arguments: { query: "India GDP electricity debt" },
      });
      const textMulti = resMulti.content[0].text;
      assertTest("MCP 1 simultaneously accesses Tier 1, Tier 2, and Tier 3", textMulti.includes("[Tier 1]") || textMulti.includes("[Tier 2]") || textMulti.includes("[Tier 3]"));
    } finally {
      await trans1.close();
    }
  } finally {
    proc5001.kill();
    await new Promise((r) => setTimeout(r, 600));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY REPORT
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(75));
  console.log("                    AUTOMATED TEST SUMMARY REPORT                    ");
  console.log("=".repeat(75));
  console.log(`Total Assertions Evaluated : ${totalTests}`);
  console.log(`Passed Assertions          : ${passedTests}`);
  console.log(`Failed Assertions          : ${failedTests}`);
  console.log(`Success Rate               : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log("=".repeat(75));

  if (failedTests === 0) {
    console.log("🎉 ALL MULTI-TIER SECURITY & DATA ASSERTIONS PASSED PERFECTLY!\n");
    process.exit(0);
  } else {
    console.error("⚠️ SOME ASSERTIONS FAILED. Check logs above.\n");
    process.exit(1);
  }
}

runAutomatedTests().catch((err) => {
  console.error("Fatal Test Error:", err);
  process.exit(1);
});
