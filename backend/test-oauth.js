import "dotenv/config";

const BASE_URL = process.env.MCP_SERVER_URL ? new URL(process.env.MCP_SERVER_URL).origin : "http://localhost:3001";
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "secondbrain_claude";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

console.log("=================================================");
console.log("    SECOND BRAIN MCP — OAUTH 2.0 VERIFICATION    ");
console.log("=================================================");
console.log(`Target Base URL: ${BASE_URL}`);
console.log(`Client ID:       ${CLIENT_ID}`);

async function runTests() {
  let testsPassed = 0;
  let totalTests = 5;

  try {
    // ── Test 1: Discovery Endpoint ──────────────────────────────────────────
    console.log("\n[Test 1] Testing RFC 8414 Discovery Endpoint...");
    const discRes = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`);
    if (discRes.status === 200) {
      const discData = await discRes.json();
      console.log("  [PASS] Discovery endpoint active!");
      console.log(`         Authorization: ${discData.authorization_endpoint}`);
      console.log(`         Token:         ${discData.token_endpoint}`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] Expected 200, got ${discRes.status}`);
    }

    // ── Test 2: Unauthenticated /mcp Rejected ──────────────────────────────
    console.log("\n[Test 2] Verifying unauthenticated request to /mcp is rejected (401)...");
    const unauthRes = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } }
      })
    });

    if (unauthRes.status === 401) {
      const errBody = await unauthRes.json();
      console.log(`  [PASS] Unauthenticated request correctly rejected with 401: "${errBody.error?.message}"`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] Expected 401 Unauthorized, got ${unauthRes.status}`);
    }

    // ── Test 3: OAuth Authorization Code Flow ──────────────────────────────
    console.log("\n[Test 3] Testing Authorization Code Grant Flow...");
    const authUrl = `${BASE_URL}/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=http://localhost:3000/callback&response_type=code&state=random_state_123&auto_approve=true`;
    const authRes = await fetch(authUrl, { redirect: "manual" });

    const locationHeader = authRes.headers.get("location");
    if (!locationHeader) {
      throw new Error(`Expected redirect from /oauth/authorize, got status ${authRes.status}`);
    }

    const redirectParams = new URL(locationHeader).searchParams;
    const authCode = redirectParams.get("code");
    console.log(`  [OK] Received Authorization Code: ${authCode.substring(0, 10)}...`);

    // Exchange Code for Access Token
    const tokenRes = await fetch(`${BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: "http://localhost:3000/callback"
      }).toString()
    });

    if (tokenRes.status !== 200) {
      throw new Error(`Token exchange failed with status ${tokenRes.status}: ${await tokenRes.text()}`);
    }

    const tokenData = await tokenRes.json();
    console.log("  [PASS] Successfully exchanged code for Access Token!");
    console.log(`         Token Type: ${tokenData.token_type}`);
    console.log(`         Expires In: ${tokenData.expires_in} seconds`);
    console.log(`         JWT:        ${tokenData.access_token.substring(0, 25)}...`);
    testsPassed++;

    const accessToken = tokenData.access_token;

    // ── Test 4: Userinfo Endpoint ──────────────────────────────────────────
    console.log("\n[Test 4] Testing /oauth/userinfo with Bearer token...");
    const userinfoRes = await fetch(`${BASE_URL}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (userinfoRes.status === 200) {
      const userData = await userinfoRes.json();
      console.log(`  [PASS] Userinfo returned: sub="${userData.sub}", name="${userData.name}"`);
      testsPassed++;
    } else {
      console.error(`  [FAIL] Expected 200, got ${userinfoRes.status}`);
    }

    // ── Test 5: Authenticated MCP Connection ───────────────────────────────
    console.log("\n[Test 5] Calling /mcp with Bearer Token (JSON-RPC initialize)...");
    const mcpRes = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "ClaudeTestClient", version: "1.0.0" }
        }
      })
    });

    if (mcpRes.status === 200) {
      const rawText = await mcpRes.text();
      let mcpData = null;
      try {
        mcpData = JSON.parse(rawText);
      } catch {
        // Parse SSE stream format: data: {...}
        const match = rawText.match(/data:\s*(\{.*\})/);
        if (match) {
          mcpData = JSON.parse(match[1]);
        }
      }

      console.log("  [PASS] Authenticated MCP session initialized successfully!");
      if (mcpData?.result?.serverInfo) {
        console.log(`         Server Name:    ${mcpData.result.serverInfo.name}`);
        console.log(`         Server Version: ${mcpData.result.serverInfo.version}`);
      }
      const sessionId = mcpRes.headers.get("mcp-session-id");
      if (sessionId) {
        console.log(`         MCP Session ID: ${sessionId}`);
        
        // ── Test 6: List Available Tools via Session ────────────────────────
        console.log("\n[Test 6] Fetching available MCP tools via authenticated session...");
        totalTests = 6;
        const toolsRes = await fetch(`${BASE_URL}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
            "mcp-session-id": sessionId,
            "Accept": "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {}
          })
        });

        if (toolsRes.status === 200) {
          const rawTools = await toolsRes.text();
          let toolsData = null;
          try {
            toolsData = JSON.parse(rawTools);
          } catch {
            const match = rawTools.match(/data:\s*(\{.*\})/);
            if (match) toolsData = JSON.parse(match[1]);
          }
          const tools = toolsData?.result?.tools || [];
          console.log(`  [PASS] Successfully retrieved ${tools.length} database tools via OAuth!`);
          tools.slice(0, 5).forEach((t) => console.log(`         - ${t.name}`));
          testsPassed++;

          // ── Test 7: Call a Tool via Authenticated Session ─────────────────
          console.log("\n[Test 7] Executing tool 'list_economic_indicators_and_entities' via OAuth session...");
          totalTests = 7;
          const callRes = await fetch(`${BASE_URL}/mcp`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
              "mcp-session-id": sessionId,
              "Accept": "application/json, text/event-stream"
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: {
                name: "list_economic_indicators_and_entities",
                arguments: { type: "countries" }
              }
            })
          });

          if (callRes.status === 200) {
            const rawCall = await callRes.text();
            let callData = null;
            try {
              callData = JSON.parse(rawCall);
            } catch {
              const match = rawCall.match(/data:\s*(\{.*\})/);
              if (match) callData = JSON.parse(match[1]);
            }
            if (callData?.result?.isError) {
              console.error(`  [FAIL] Tool returned error: ${callData.result.content?.[0]?.text}`);
            } else {
              console.log("  [PASS] Tool executed successfully!");
              const text = callData?.result?.content?.[0]?.text || "";
              console.log(`         Response preview: ${text.substring(0, 100).replace(/\n/g, " ")}...`);
              testsPassed++;
            }
          } else {
            console.error(`  [FAIL] Tool execution HTTP status: ${callRes.status}`);
          }
        } else {
          console.error(`  [FAIL] Failed to list tools: ${toolsRes.status}`);
        }
      }
      testsPassed++;
    } else {
      console.error(`  [FAIL] MCP initialize failed with status ${mcpRes.status}: ${await mcpRes.text()}`);
    }

    console.log("\n=================================================");
    console.log(`  VERIFICATION RESULTS: ${testsPassed}/${totalTests} TESTS PASSED`);
    console.log("=================================================\n");

  } catch (err) {
    console.error("\n[ERROR] Verification encountered an error:", err.message);
  }
}

runTests();
