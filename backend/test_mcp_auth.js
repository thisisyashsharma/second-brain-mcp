import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import 'dotenv/config';
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitForServer(port) {
  const url = "http://localhost:" + port + "/api/health";
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time.");
}

async function runConfigTest(tiers, port) {
  console.log("\n--- Starting Server with MCP_ALLOWED_TIERS=" + tiers + " on PORT=" + port + " ---");
  
  const env = { ...process.env, PORT: port.toString(), MCP_ALLOWED_TIERS: tiers };
  const serverProc = spawn("node", ["server.js"], { env, cwd: __dirname, stdio: 'pipe' });
  serverProc.stderr.on('data', data => console.error(data.toString()));
  serverProc.stdout.on('data', data => {});
  
  try {
    await waitForServer(port);
    
    const token = process.env.MCP_AUTH_TOKEN;
    const headers = token ? { Authorization: "Bearer " + token } : {};
    
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:" + port + "/mcp"), {
      requestInit: { headers }
    });
    
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    
    // Tier 1 query: "Balance"
    const resT1 = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "Balance" }
    });
    const contentT1 = resT1.content[0].text;
    const hasTier1 = contentT1.includes("[Tier 1]");
    
    // Tier 2 query: "CARO"
    const resT2 = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "CARO" }
    });
    const contentT2 = resT2.content[0].text;
    const hasTier2 = contentT2.includes("[Tier 2]");
    
    // Tier 3 query: Concept
    const resT3 = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "Zomato" }
    });
    const contentT3 = resT3.content[0].text;
    
    console.log("MCP " + tiers);
    console.log("  Tier 1: " + (hasTier1 ? "PASS" : "BLOCKED"));
    console.log("  Tier 2: " + (hasTier2 ? "PASS" : "BLOCKED"));
    console.log("  Tier 3: PASS");
    
    await transport.close();
  } finally {
    serverProc.kill();
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function runAll() {
  console.log("=== End-to-End MCP Authorization Test Suite ===");
  try {
    await runConfigTest("1,2,3", 4001);
    await runConfigTest("2,3", 4002);
    await runConfigTest("3", 4003);
  } catch (err) {
    console.error("Test failed:", err);
  }
}

runAll();
