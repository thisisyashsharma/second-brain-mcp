import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";

// In-memory store for authorization codes (TTL 5 minutes)
const authCodes = new Map();

// Helper to clean expired codes
function cleanupExpiredCodes() {
  const now = Date.now();
  for (const [code, data] of authCodes.entries()) {
    if (data.expiresAt < now) {
      authCodes.delete(code);
    }
  }
}
setInterval(cleanupExpiredCodes, 60000).unref();

/**
 * Get configured client credentials from environment
 */
function getOAuthConfig() {
  const clientId = process.env.OAUTH_CLIENT_ID || "secondbrain_claude";
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || "secondbrain_secret_2026";
  const jwtSecret = process.env.JWT_SECRET || "secondbrain_default_jwt_secret_change_in_prod";
  const jwksUri = process.env.OAUTH_JWKS_URI || null;
  const allowedRedirects = process.env.OAUTH_ALLOWED_REDIRECT_URIS
    ? process.env.OAUTH_ALLOWED_REDIRECT_URIS.split(",").map((s) => s.trim())
    : [];

  return { clientId, clientSecret, jwtSecret, jwksUri, allowedRedirects };
}

/**
 * Generate a signed JWT Access Token
 */
async function generateAccessToken({ sub, scope, clientId, baseUrl }) {
  const { jwtSecret } = getOAuthConfig();
  const secretKey = new TextEncoder().encode(jwtSecret);

  const token = await new SignJWT({
    sub: sub || "secondbrain_owner",
    scope: scope || "mcp:all",
    client_id: clientId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(baseUrl || "secondbrain-mcp")
    .setAudience("secondbrain-mcp")
    .setExpirationTime("24h")
    .sign(secretKey);

  return token;
}

/**
 * Verify an incoming Bearer access token
 * Supports both locally signed JWTs (HS256) and external IdP JWKS (RS256/ES256)
 */
let remoteJWKS = null;
export async function verifyAccessToken(token) {
  if (!token) {
    return { valid: false, error: "Missing token" };
  }

  const { jwtSecret, jwksUri } = getOAuthConfig();

  try {
    // 1. If external JWKS URI is configured (e.g. Auth0 / Supabase)
    if (jwksUri) {
      if (!remoteJWKS) {
        remoteJWKS = createRemoteJWKSet(new URL(jwksUri));
      }
      const { payload } = await jwtVerify(token, remoteJWKS);
      return { valid: true, payload };
    }

    // 2. Otherwise verify locally signed HS256 token
    const secretKey = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secretKey, {
      audience: "secondbrain-mcp",
    });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Set up OAuth 2.0 endpoints on Express app
 */
export function setupOAuthRoutes(app) {
  // ── RFC 8414 Discovery Endpoints ──────────────────────────────────────────
  const discoveryHandler = (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}`;

    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "client_credentials"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      scopes_supported: ["mcp:all", "read", "write", "openid", "profile"],
    });
  };

  app.get("/.well-known/oauth-authorization-server", discoveryHandler);
  app.get("/.well-known/openid-configuration", discoveryHandler);

  // ── Authorization Endpoint (GET /oauth/authorize) ─────────────────────────
  app.get("/oauth/authorize", (req, res) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      scope = "mcp:all",
      prompt,
    } = req.query;

    const { clientId, allowedRedirects } = getOAuthConfig();

    if (!client_id || client_id !== clientId) {
      return res.status(400).send("Invalid or missing client_id");
    }

    if (!redirect_uri) {
      return res.status(400).send("Missing redirect_uri");
    }

    if (allowedRedirects.length > 0) {
      const isAllowed = allowedRedirects.some((allowed) =>
        redirect_uri.startsWith(allowed)
      );
      if (!isAllowed) {
        return res.status(400).send("redirect_uri not in allowed whitelist");
      }
    }

    if (response_type !== "code") {
      return res.status(400).send("Unsupported response_type. Must be 'code'");
    }

    // Auto-approve if prompt=none or if auto_approve=true
    if (prompt === "none" || req.query.auto_approve === "true") {
      const code = randomBytes(24).toString("hex");
      authCodes.set(code, {
        clientId: client_id,
        redirectUri: redirect_uri,
        scope,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);
      return res.redirect(redirectUrl.toString());
    }

    // Render Clean HTML Authorization Screen
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Second Brain Access</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 36px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      background: #3b82f6;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #f8fafc; }
    p { font-size: 14px; line-height: 1.5; color: #94a3b8; margin-bottom: 24px; }
    .client-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 24px;
    }
    .client-title { font-weight: 600; font-size: 14px; color: #38bdf8; margin-bottom: 4px; }
    .client-desc { font-size: 12px; color: #64748b; word-break: break-all; }
    .actions { display: flex; gap: 12px; }
    button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-approve {
      background: #2563eb;
      color: #ffffff;
    }
    .btn-approve:hover { background: #1d4ed8; }
    .btn-deny {
      background: #334155;
      color: #cbd5e1;
    }
    .btn-deny:hover { background: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">OAuth 2.0 Auth</span>
    <h1>Connect to Second Brain</h1>
    <p>An application is requesting authorized access to query your Second Brain knowledge base and analytical tools via MCP.</p>
    
    <div class="client-box">
      <div class="client-title">Client ID: ${client_id}</div>
      <div class="client-desc">Redirect URI: ${redirect_uri}</div>
    </div>

    <form method="POST" action="/oauth/authorize/confirm">
      <input type="hidden" name="client_id" value="${client_id}">
      <input type="hidden" name="redirect_uri" value="${redirect_uri}">
      <input type="hidden" name="state" value="${state || ""}">
      <input type="hidden" name="scope" value="${scope}">
      
      <div class="actions">
        <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
        <button type="submit" name="action" value="approve" class="btn-approve">Authorize</button>
      </div>
    </form>
  </div>
</body>
</html>`;
    res.send(html);
  });

  // ── Confirmation POST Route ───────────────────────────────────────────────
  app.post("/oauth/authorize/confirm", (req, res) => {
    const { client_id, redirect_uri, state, scope, action } = req.body;

    if (action !== "approve") {
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("error", "access_denied");
      if (state) redirectUrl.searchParams.set("state", state);
      return res.redirect(redirectUrl.toString());
    }

    const code = randomBytes(24).toString("hex");
    authCodes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      scope: scope || "mcp:all",
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    return res.redirect(redirectUrl.toString());
  });

  // ── Token Endpoint (POST /oauth/token) ─────────────────────────────────────
  app.post("/oauth/token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    // Extract credentials from body or Basic Auth
    let reqClientId = req.body.client_id;
    let reqClientSecret = req.body.client_secret;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Basic ")) {
      const credentials = Buffer.from(authHeader.split(" ")[1], "base64").toString("utf-8");
      const [u, p] = credentials.split(":");
      reqClientId = reqClientId || u;
      reqClientSecret = reqClientSecret || p;
    }

    const { clientId, clientSecret } = getOAuthConfig();

    // Authenticate client
    if (reqClientId !== clientId || reqClientSecret !== clientSecret) {
      return res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
    }

    const grantType = req.body.grant_type;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}`;

    // Grant 1: Authorization Code
    if (grantType === "authorization_code") {
      const { code, redirect_uri } = req.body;
      if (!code) {
        return res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
      }

      const stored = authCodes.get(code);
      if (!stored || stored.expiresAt < Date.now()) {
        authCodes.delete(code);
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Authorization code invalid or expired",
        });
      }

      if (stored.clientId !== reqClientId) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Client mismatch" });
      }

      // Codes are single-use
      authCodes.delete(code);

      const token = await generateAccessToken({
        sub: "secondbrain_user",
        scope: stored.scope,
        clientId: reqClientId,
        baseUrl,
      });

      return res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 86400, // 24 hours
        scope: stored.scope,
      });
    }

    // Grant 2: Client Credentials
    if (grantType === "client_credentials") {
      const scope = req.body.scope || "mcp:all";
      const token = await generateAccessToken({
        sub: "secondbrain_service",
        scope,
        clientId: reqClientId,
        baseUrl,
      });

      return res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 86400,
        scope,
      });
    }

    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: `Grant type '${grantType}' is not supported`,
    });
  });

  // ── Userinfo Endpoint (GET /oauth/userinfo) ───────────────────────────────
  app.get("/oauth/userinfo", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const verification = await verifyAccessToken(token);

    if (!verification.valid) {
      return res.status(401).json({ error: "invalid_token", error_description: verification.error });
    }

    return res.json({
      sub: verification.payload.sub || "secondbrain_user",
      name: "Second Brain Admin",
      email: "admin@secondbrain.local",
      scope: verification.payload.scope || "mcp:all",
    });
  });
}
