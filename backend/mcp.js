import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  searchKnowledge,
  getConceptByName,
  getRelatedConcepts,
  getDocumentByPath,
  safeTruncate,
  MAX_DOCUMENT_CONTEXT_CHARS,
} from "./services/knowledge.js";

function createMcpServer() {
  const server = new Server(
    {
      name: "SecondBrain-MCP",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search_knowledge",
          description: "Search the existing PostgreSQL-backed Second Brain for wiki concepts and raw documents.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query or keywords" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_concept",
          description: "Get detailed information about a wiki concept (summary, full content, source documents).",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name of the concept" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_related_concepts",
          description: "Query wiki_relationships for a given concept.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name of the concept" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_document",
          description: "Retrieve a raw uploaded document from PostgreSQL using its relative path.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative path of the document (e.g. AI/LLM/attention.md)" },
            },
            required: ["path"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "search_knowledge") {
      const { query } = args;
      if (!query) throw new Error("Query is required");

      const { scoredConcepts, scoredDocs } = await searchKnowledge(query);

      let resultText = `Search Results for: "${query}"\n\n`;

      if (scoredConcepts.length > 0) {
        resultText += `--- WIKI CONCEPTS ---\n`;
        scoredConcepts.forEach(c => {
          resultText += `Concept: ${c.name}\nSummary: ${c.summary || "(None)"}\nExcerpt: ${safeTruncate(c.content, 500)}\n\n`;
        });
      }

      if (scoredDocs.length > 0) {
        resultText += `--- RAW DOCUMENTS ---\n`;
        scoredDocs.forEach(d => {
          resultText += `Path: ${d.filepath}\nExcerpt: ${safeTruncate(d.content, 500)}\n\n`;
        });
      }

      if (scoredConcepts.length === 0 && scoredDocs.length === 0) {
        resultText += "No relevant concepts or documents found.";
      }

      return {
        content: [{ type: "text", text: resultText }],
      };
    }

    if (name === "get_concept") {
      const { name: conceptName } = args;
      if (!conceptName) throw new Error("Concept name is required");

      const data = await getConceptByName(conceptName);
      if (!data) return { content: [{ type: "text", text: `Concept '${conceptName}' not found.` }] };

      let resultText = `Concept: ${data.concept.name}\nSummary: ${data.concept.summary}\n\nContent:\n${data.concept.content}\n\n`;
      
      if (data.sources.length > 0) {
        resultText += `Sources:\n` + data.sources.map(s => `- ${s.filepath}`).join("\n") + "\n\n";
      }
      if (data.relationships.length > 0) {
        resultText += `Related:\n` + data.relationships.map(r => `- ${r.name} (${r.relationship}, ${r.direction})`).join("\n");
      }

      return {
        content: [{ type: "text", text: resultText }],
      };
    }

    if (name === "get_related_concepts") {
      const { name: conceptName } = args;
      if (!conceptName) throw new Error("Concept name is required");

      const rels = await getRelatedConcepts(conceptName);
      if (!rels) return { content: [{ type: "text", text: `Concept '${conceptName}' not found.` }] };

      if (rels.length === 0) return { content: [{ type: "text", text: `No relationships found for '${conceptName}'.` }] };

      let resultText = `Relationships for ${conceptName}:\n`;
      resultText += rels.map(r => `- ${r.name} (${r.relationship}, ${r.direction})`).join("\n");

      return {
        content: [{ type: "text", text: resultText }],
      };
    }

    if (name === "get_document") {
      const { path } = args;
      if (!path) throw new Error("Document path is required");

      const doc = await getDocumentByPath(path);
      if (!doc) return { content: [{ type: "text", text: `Document at '${path}' not found.` }] };

      const content = safeTruncate(doc.content, MAX_DOCUMENT_CONTEXT_CHARS);
      return {
        content: [
          {
            type: "text",
            text: `Document: ${doc.filename}\nPath: ${doc.filepath}\nType: ${doc.filetype}\n\nContent:\n${content}`,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  return server;
}

export function setupMcpServer(app) {
  // Authentication Middleware
  const requireAuth = (req, res, next) => {
    // Simple local configuration bypass or explicit token check
    const expectedToken = process.env.MCP_AUTH_TOKEN;
    if (!expectedToken) {
      // If no token is configured, allow for local dev
      return next();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ error: "Unauthorized MCP access" });
    }
    next();
  };

  // Map to store active sessions (sessionId -> { server, transport })
  const sessions = new Map();

  // Wire up the single route (handling GET, POST, DELETE, etc.)
  app.all("/mcp", requireAuth, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          return res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          });
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      // New session / initialization request
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
        },
        onsessionclosed: (closedSessionId) => {
          sessions.delete(closedSessionId);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP Server Error:", err);
      if (!res.headersSent) res.status(500).send(err.message);
    }
  });
}
