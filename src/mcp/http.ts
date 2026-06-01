import * as http from 'node:http';
import * as express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

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

function setCorsHeaders(
  res: http.ServerResponse,
  origin: string | undefined,
  allowedOrigins: ReadonlyArray<string | RegExp>,
): void {
  // Set Access-Control-Allow-Origin if origin is allowed
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // No origin header (non-browser client) - allow
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // These headers are safe to always set
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

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
 *   - GET  /health   → { "status": "ok" }
 *   - POST /mcp      → MCP JSON-RPC endpoint
 *   - OPTIONS /mcp or * → CORS preflight
 *
 * Origin validation is applied to all /mcp requests.
 * CORS headers are set on every response.
 */
export async function startHttpServer(
  createMcpServer: () => Server, // Factory function to create MCP server per request
  options: HttpServerOptions,
): Promise<{ server: http.Server }> {
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;

  // Create Express app with SDK helper (includes json body parsing and host validation)
  const app = createMcpExpressApp({ host: options.host });

  // Custom middleware to set CORS headers on all responses
  app.use((req, res, next) => {
    setCorsHeaders(res, req.headers.origin, allowedOrigins);
    next();
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // MCP endpoint
  app.post('/mcp', async (req, res) => {
    // Create a new MCP server and transport for each request (stateless)
    let server: Server | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    
    try {
      console.error('MCP endpoint hit', req.method, req.path, req.headers.origin);
      
      // Validate Origin
      const origin = req.headers.origin as string | undefined;
      if (!isOriginAllowed(origin, allowedOrigins)) {
        console.error(`Origin not allowed: ${origin}`);
        // Do not set CORS headers for disallowed origin
        res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Origin not allowed' },
        });
        return;
      }
      
      console.error('Origin validation passed, origin:', origin);
      console.error('Request body:', req.body);

      // Create new MCP server and transport for this request
      server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      
      // Connect the MCP server to the transport
      await server.connect(transport);
      
      // Handle the MCP request
      await transport.handleRequest(req, res, req.body);
      console.error('MCP request handled successfully');
      
      // Close transport and server when response closes
      res.on('close', async () => {
        console.error('Response closed, cleaning up');
        try {
          if (transport) await transport.close();
        } catch (e) {
          // Ignore errors on close
        }
        try {
          if (server) await server.close();
        } catch (e) {
          // Ignore errors on close
        }
      });
    } catch (err) {
      console.error('Error in MCP endpoint:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
        });
      } else {
        res.end();
      }
      // Clean up on error
      try {
        if (transport) await transport.close();
      } catch (e) { /* ignore */ }
      try {
        if (server) await server.close();
      } catch (e) { /* ignore */ }
    }
  });

  // Handle OPTIONS for /mcp (CORS preflight)
  app.options('/mcp', (_req, res) => {
    res.sendStatus(204);
  });

  // 404 for everything else
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Create the Node.js HTTP server from the Express app
  const server = http.createServer(app);

  // Start listening
  return new Promise((resolve, reject) => {
    server.listen(options.port, options.host, () => {
      resolve({ server });
    });
    server.on('error', reject);
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────

export async function closeHttpServer(
  server: http.Server
): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}