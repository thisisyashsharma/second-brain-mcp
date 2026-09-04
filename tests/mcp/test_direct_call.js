import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), "backend/.env") });

async function test() {
  console.log("Connecting to running server on http://localhost:3001/mcp...");
  const token = process.env.MCP_AUTH_TOKEN;
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  const client = new Client({ name: "direct-tester", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("Connected!");

  console.log("Calling list_economic_indicators_and_entities { filter: 'India', type: 'indicators' }...");
  console.time("call");
  const res = await client.callTool({
    name: "list_economic_indicators_and_entities",
    arguments: { filter: "India", type: "indicators" }
  });
  console.timeEnd("call");
  console.log("Result:\n", res.content[0].text);
  process.exit(0);
}

test().catch(e => { console.error("Error:", e); process.exit(1); });
