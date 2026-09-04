import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { verifyAccessToken } from "./oauth.js";
import {
  searchKnowledge,
  getConceptByName,
  getRelatedConcepts,
  getDocumentByPath,
  safeTruncate,
  MAX_DOCUMENT_CONTEXT_CHARS,
  listEconomicIndicatorsAndEntities,
  getDocumentTocAndSections,
  getIndicatorTimeseries,
  compareCountryMetrics,
  crossReferenceMacroWithMicro,
  traceConceptGraph,
  auditMetricDiscrepancy,
  saveAnalyticalBrief,
} from "./services/knowledge.js";

function createMcpServer() {
  const server = new Server(
    {
      name: "SecondBrain-MCP",
      version: "2.0.0",
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
        // ── Discovery & Grounding Tools ──────────────────────────────────
        {
          name: "list_economic_indicators_and_entities",
          description: "Discover all indexed countries, macroeconomic indicators, and documents available in the Second Brain database.",
          inputSchema: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["all", "countries", "indicators", "documents"],
                description: "Type of entities to list (defaults to 'all')",
              },
              filter: {
                type: "string",
                description: "Optional keyword to filter country or indicator names",
              },
            },
          },
        },
        {
          name: "get_document_toc_and_sections",
          description: "Get the Table of Contents, section hierarchy, page ranges, and tier security classifications for a document.",
          inputSchema: {
            type: "object",
            properties: {
              documentId: { type: "number", description: "Optional document ID" },
              filepath: { type: "string", description: "Optional relative filepath" },
            },
          },
        },

        // ── Search & Knowledge Retrieval Tools ───────────────────────────
        {
          name: "search_knowledge",
          description: "Search the PostgreSQL-backed Second Brain for wiki concepts, raw documents, sections, and tables within allowed tiers.",
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
          description: "Query wiki_relationships for direct connections to a given concept.",
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

        // ── Quantitative & Analytical Tools ──────────────────────────────
        {
          name: "get_indicator_timeseries",
          description: "Fetch clean year-by-year time-series data for a country and indicator from structured tables, with automated CAGR and growth analytics.",
          inputSchema: {
            type: "object",
            properties: {
              country: { type: "string", description: "Country name or code (e.g. 'Angola', 'India', 'AGO')" },
              indicator: { type: "string", description: "Indicator name or keyword (e.g. 'External debt', 'GDP', 'Inflation')" },
              startYear: { type: "number", description: "Optional start year filter (e.g. 2000)" },
              endYear: { type: "number", description: "Optional end year filter (e.g. 2023)" },
            },
            required: ["country", "indicator"],
          },
        },
        {
          name: "compare_country_metrics",
          description: "Compare an economic metric across multiple countries with automated ranking, growth percentage, and benchmarking.",
          inputSchema: {
            type: "object",
            properties: {
              countries: {
                type: "array",
                items: { type: "string" },
                description: "Array of country names or codes (e.g. ['India', 'Brazil', 'Angola'])",
              },
              indicator: { type: "string", description: "Indicator to benchmark (e.g. 'External debt stocks', 'GDP')" },
              year: { type: "number", description: "Optional specific year for comparison" },
              startYear: { type: "number", description: "Optional start year for trend comparison" },
              endYear: { type: "number", description: "Optional end year for trend comparison" },
            },
            required: ["countries", "indicator"],
          },
        },

        // ── Synthesis, Graph & Auditing Tools ────────────────────────────
        {
          name: "cross_reference_macro_with_micro",
          description: "Cross-reference macroeconomic indicators (World Bank) with corporate financial statements (e.g. Zomato costs, borrowings) to synthesize economic impact.",
          inputSchema: {
            type: "object",
            properties: {
              macroQuery: { type: "string", description: "Macroeconomic factor/indicator (e.g. 'Inflation consumer prices', 'External debt')" },
              microQuery: { type: "string", description: "Micro/corporate query or keyword (e.g. 'Zomato delivery expenses', 'Borrowings')" },
            },
            required: ["macroQuery", "microQuery"],
          },
        },
        {
          name: "trace_concept_graph",
          description: "Traverse multi-hop relationships in the knowledge graph starting from a root concept to uncover causal and conceptual paths.",
          inputSchema: {
            type: "object",
            properties: {
              conceptName: { type: "string", description: "Root concept name (e.g. 'Attention', 'External Debt')" },
              depth: { type: "number", description: "Max traversal depth (1 to 4, default 2)" },
            },
            required: ["conceptName"],
          },
        },
        {
          name: "audit_metric_discrepancy",
          description: "Audit data consistency and provenance across security tiers (Tier 1 Audited vs Tier 2 Operational vs Tier 3 Public).",
          inputSchema: {
            type: "object",
            properties: {
              entity: { type: "string", description: "Company, country, or entity name" },
              metric: { type: "string", description: "Metric or financial term to audit" },
            },
            required: ["metric"],
          },
        },
        {
          name: "save_analytical_brief",
          description: "Persist an analytical brief, synthesized research, or multi-step reasoning into the Second Brain PostgreSQL knowledge graph.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title of the research brief / concept" },
              slug: { type: "string", description: "Optional URL-friendly slug" },
              summary: { type: "string", description: "Executive summary of the findings" },
              content: { type: "string", description: "Full analytical content and step-by-step reasoning (Markdown)" },
              relatedConcepts: {
                type: "array",
                items: { type: "string" },
                description: "Names of existing concepts to link to in the knowledge graph",
              },
              sourceDocumentPaths: {
                type: "array",
                items: { type: "string" },
                description: "Relative filepaths of source documents used in the analysis",
              },
            },
            required: ["title", "content"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    // Parse allowed tiers from env (defaults to [3] for safety)
    const allowedTiersStr = process.env.MCP_ALLOWED_TIERS || "3";
    const allowedTiers = allowedTiersStr.split(",").map(s => parseInt(s.trim()));

    // ── 1. list_economic_indicators_and_entities ────────────────────────
    if (name === "list_economic_indicators_and_entities") {
      const data = await listEconomicIndicatorsAndEntities(args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 2. get_document_toc_and_sections ────────────────────────────────
    if (name === "get_document_toc_and_sections") {
      const data = await getDocumentTocAndSections({
        documentId: args?.documentId,
        filepath: args?.filepath,
        allowedTiers,
      });
      if (!data) return { content: [{ type: "text", text: "Document not found." }] };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 3. search_knowledge ─────────────────────────────────────────────
    if (name === "search_knowledge") {
      const { query } = args;
      if (!query) throw new Error("Query is required");

      const { scoredConcepts, scoredDocs, scoredSections, scoredTables } = await searchKnowledge(query, allowedTiers);

      let resultText = `Search Results for: "${query}" (Allowed Tiers: ${allowedTiers.join(", ")})\n\n`;

      if (scoredConcepts.length > 0) {
        resultText += `--- WIKI CONCEPTS ---\n`;
        scoredConcepts.forEach(c => {
          resultText += `Concept: ${c.name}\nSummary: ${c.summary || "(None)"}\nExcerpt: ${safeTruncate(c.content, 500)}\n\n`;
        });
      }

      if (scoredDocs.length > 0) {
        resultText += `--- RAW DOCUMENTS (Legacy) ---\n`;
        scoredDocs.forEach(d => {
          resultText += `Path: ${d.filepath}\nExcerpt: ${safeTruncate(d.content, 2000)}\n\n`;
        });
      }

      if (scoredSections && scoredSections.length > 0) {
        resultText += `--- DOCUMENT SECTIONS ---\n`;
        scoredSections.forEach(s => {
          resultText += `Section: ${s.section_title} [Tier ${s.tier}]\nDocument: ${s.filename}\nExcerpt: ${safeTruncate(s.content, 2000)}\n\n`;
        });
      }

      if (scoredTables && scoredTables.length > 0) {
        resultText += `--- DOCUMENT TABLES ---\n`;
        scoredTables.forEach(t => {
          resultText += `Table: ${t.table_title} [Tier ${t.tier}]\nSection: ${t.section_title}\nDocument: ${t.filename}\nHeaders: ${JSON.stringify(t.headers)}\nRows: ${JSON.stringify(t.rows)}\n\n`;
        });
      }

      if (scoredConcepts.length === 0 && scoredDocs.length === 0 && (!scoredSections || scoredSections.length === 0) && (!scoredTables || scoredTables.length === 0)) {
        resultText += "No relevant concepts, documents, sections, or tables found.";
      }

      return {
        content: [{ type: "text", text: resultText }],
      };
    }

    // ── 4. get_concept ──────────────────────────────────────────────────
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

    // ── 5. get_related_concepts ─────────────────────────────────────────
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

    // ── 6. get_document ─────────────────────────────────────────────────
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

    // ── 7. get_indicator_timeseries ─────────────────────────────────────
    if (name === "get_indicator_timeseries") {
      const data = await getIndicatorTimeseries({
        country: args.country,
        indicator: args.indicator,
        startYear: args.startYear,
        endYear: args.endYear,
        allowedTiers,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 8. compare_country_metrics ──────────────────────────────────────
    if (name === "compare_country_metrics") {
      const data = await compareCountryMetrics({
        countries: args.countries,
        indicator: args.indicator,
        year: args.year,
        startYear: args.startYear,
        endYear: args.endYear,
        allowedTiers,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 9. cross_reference_macro_with_micro ─────────────────────────────
    if (name === "cross_reference_macro_with_micro") {
      const data = await crossReferenceMacroWithMicro({
        macroQuery: args.macroQuery,
        microQuery: args.microQuery,
        allowedTiers,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 10. trace_concept_graph ─────────────────────────────────────────
    if (name === "trace_concept_graph") {
      const data = await traceConceptGraph({
        conceptName: args.conceptName,
        depth: args.depth,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 11. audit_metric_discrepancy ────────────────────────────────────
    if (name === "audit_metric_discrepancy") {
      const data = await auditMetricDiscrepancy({
        entity: args.entity,
        metric: args.metric,
        allowedTiers,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 12. save_analytical_brief ───────────────────────────────────────
    if (name === "save_analytical_brief") {
      const data = await saveAnalyticalBrief({
        title: args.title,
        slug: args.slug,
        summary: args.summary,
        content: args.content,
        relatedConcepts: args.relatedConcepts,
        sourceDocumentPaths: args.sourceDocumentPaths,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  return server;
}


export function setupMcpServer(app) {
  // Authentication Middleware (OAuth 2.0 Bearer Token)
  const requireAuth = async (req, res, next) => {
    // CORS preflight requests bypass
    if (req.method === "OPTIONS") return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // Check if insecure dev mode is explicitly allowed
      const allowInsecureDev =
        process.env.NODE_ENV !== "production" &&
        process.env.OAUTH_ALLOW_INSECURE_DEV === "true";

      if (allowInsecureDev) {
        return next();
      }

      return res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Missing or invalid Authorization header. Bearer token required.",
        },
        id: null,
      });
    }

    const token = authHeader.split(" ")[1];

    // Backward compatibility with legacy static MCP_AUTH_TOKEN
    if (process.env.MCP_AUTH_TOKEN && token === process.env.MCP_AUTH_TOKEN) {
      req.user = { sub: "static_token_user", scope: "mcp:all" };
      return next();
    }

    // Verify OAuth 2.0 JWT or JWKS token
    const verification = await verifyAccessToken(token);
    if (!verification.valid) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Unauthorized: ${verification.error}`,
        },
        id: null,
      });
    }

    // Attach authenticated identity to request
    req.user = verification.payload;
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
