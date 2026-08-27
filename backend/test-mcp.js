import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function runTest() {
  const token = process.env.MCP_AUTH_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  console.log("Connecting to local MCP Server using Streamable HTTP...");
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp"), {
    requestInit: { headers }
  });
  
  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });
  
  await client.connect(transport);
  console.log("Connected!\n");

  try {
    // 1. search_knowledge
    console.log("==> Testing search_knowledge('multi-word query')");
    const searchRes = await client.callTool({
      name: "search_knowledge",
      arguments: { query: "Zomato Annual Report 2022 detailed revenue breakdown across segments" }
    });
    console.log(searchRes.content[0].text + "\n");

    // 2. get_concept
    console.log("==> Testing get_concept('Attention')");
    const conceptRes = await client.callTool({
      name: "get_concept",
      arguments: { name: "Attention" }
    });
    console.log(conceptRes.content[0].text.substring(0, 300) + "...\n");

    // 3. get_related_concepts
    console.log("==> Testing get_related_concepts('Attention')");
    const relRes = await client.callTool({
      name: "get_related_concepts",
      arguments: { name: "Attention" }
    });
    console.log(relRes.content[0].text.substring(0, 300) + "...\n");

    // 4. get_document
    console.log("==> Testing get_document('AI/LLM/attention.md')");
    const docRes = await client.callTool({
      name: "get_document",
      arguments: { path: "AI/LLM/attention.md" }
    });
    console.log(docRes.content[0].text.substring(0, 300) + "...\n");

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await transport.close();
    process.exit(0);
  }
}

runTest();
