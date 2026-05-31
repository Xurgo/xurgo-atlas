import * as http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface HttpServerOptions {
  host: string;
  port: number;
  allowedOrigins?: ReadonlyArray<string | RegExp>;
}

// ── Default allowed origins ────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS: ReadonlyArray<string | RegExp> = [
  'null',
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/localhost(?::\d+)?$/,
];

// ── CORS helpers ───────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

function setCorsHeaders(res: http.ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

// ── Origin validation ──────────────────────────────────────────────────

function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: ReadonlyArray<string | RegExp>,
): boolean {
  if (!origin) {
    return true; // No origin header = non-browser client, allow
  }

  for (const allowed of allowedOrigins) {
    if (typeof allowed === 'string') {
      if (origin === allowed) return true;
    } else if (allowed instanceof RegExp) {
      if (allowed.test(origin)) return true;
    }
  }

  return false;
}

// ── HTTP Server ────────────────────────────────────────────────────────

/**
 * Start an HTTP server that wraps an MCP Server with Streamable HTTP transport.
 *
 * The server exposes:
 *   - GET  /health   → `{ "status": "ok" }`
 *   - POST /mcp      → MCP JSON-RPC endpoint
 *   - OPTIONS /mcp or * → CORS preflight
 *
 * Origin validation is applied to all /mcp requests.
 * CORS headers are set on every response.
 */
export async function startHttpServer(
  mcpServer: Server,
  options: HttpServerOptions,
): Promise<{ server: http.Server; transport: StreamableHTTPServerTransport }> {
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;

  // Create the Streamable HTTP transport in stateless mode
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // Connect the MCP server to the transport
  await mcpServer.connect(transport);

  // Create the Node.js HTTP server
  const server = http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    const pathname = reqUrl.startsWith('/') ? reqUrl.split('?')[0] : '/';

    // ── CORS preflight ──────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Health check ────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/health') {
      setCorsHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // ── MCP endpoint ────────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/mcp') {
      // Validate Origin
      const origin = req.headers['origin'] as string | undefined;
      if (!isOriginAllowed(origin, allowedOrigins)) {
        setCorsHeaders(res);
        writeJsonError(res, 403, 'Origin not allowed');
        return;
      }

      // Validate Content-Type
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('application/json')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Content-Type must be application/json' } }));
        return;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid JSON-RPC request' } }));
        } else {
          res.end();
        }
      }
      return;
    }

    // ── 404 for everything else ─────────────────────────────────────
    setCorsHeaders(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // Start listening
  return new Promise((resolve, reject) => {
    server.listen(options.port, options.host, () => {
      resolve({ server, transport });
    });
    server.on('error', reject);
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────

export async function closeHttpServer(
  server: http.Server,
  transport: StreamableHTTPServerTransport,
): Promise<void> {
  try {
    await transport.close();
  } catch {
    // Transport may already be closed
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// ── JSON error helper ──────────────────────────────────────────────────

function writeJsonError(
  res: http.ServerResponse,
  status: number,
  message: string,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
    }),
  );
}
