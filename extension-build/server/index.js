#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// This bridge allows Claude Desktop (which uses stdio) to connect to our Streamable HTTP MCP server.
async function runBridge() {
  const targetUrl = process.env.MCP_SERVER_URL || "http://localhost:3001/mcp";
  const token = process.env.MCP_AUTH_TOKEN;
  
  // Skip auth if token is empty or an unresolved placeholder (e.g. from Claude Desktop extension)
  const isValidToken = token && !token.startsWith("${");
  const headers = isValidToken ? { Authorization: `Bearer ${token}` } : {};
  const httpTransport = new StreamableHTTPClientTransport(new URL(targetUrl), {
    requestInit: { headers },
  });
  
  const stdioTransport = new StdioServerTransport();
  
  // Connect stdio from Claude directly to HTTP Transport
  httpTransport.onmessage = (msg) => stdioTransport.send(msg);
  stdioTransport.onmessage = (msg) => httpTransport.send(msg);
  
  httpTransport.onerror = (err) => console.error("Streamable HTTP Error:", err);
  
  await httpTransport.start();
  await stdioTransport.start();
}

runBridge().catch(console.error);
