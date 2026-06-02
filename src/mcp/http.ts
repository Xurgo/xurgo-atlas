import * as http from 'node:http';
import * as express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { ZodError } from 'zod';
import { Project } from '../core/project.js';
import { isPathTraversal } from '../core/patch.js';
import { ProjectResolver } from './types.js';
import {
  handleContextPack,
  handleManifest,
  handleRead,
  handleReadSection,
  handleStatus,
} from './tools.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface HttpServerOptions {
  host: string;
  port: number;
  allowedOrigins?: ReadonlyArray<string | RegExp>;
  rest?: RestApiOptions;
}

export interface RestProjectSummary {
  projectId: string;
  createdAt?: string;
  updatedAt?: string;
  default?: boolean;
}

export interface RestApiOptions {
  resolveProject: ProjectResolver;
  listProjects: () => Promise<RestProjectSummary[]> | RestProjectSummary[];
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

// ── REST helpers ──────────────────────────────────────────────────────

class RestError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getQueryString(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getOptionalPositiveInt(
  value: string | string[] | undefined,
  name: string,
): number | undefined {
  const raw = getQueryString(value);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RestError(400, 'invalid_input', `${name} must be a positive integer`, { [name]: raw });
  }
  return parsed;
}

function getOptionalNonNegativeInt(
  value: string | string[] | undefined,
  name: string,
): number | undefined {
  const raw = getQueryString(value);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RestError(400, 'invalid_input', `${name} must be a non-negative integer`, { [name]: raw });
  }
  return parsed;
}

function getOptionalBoolean(
  value: string | string[] | undefined,
  name: string,
): boolean | undefined {
  const raw = getQueryString(value);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  throw new RestError(400, 'invalid_input', `${name} must be a boolean`, { [name]: raw });
}

async function resolveRestProject(
  rest: RestApiOptions,
  projectId: string,
): Promise<Project> {
  try {
    return await rest.resolveProject(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RestError(404, 'project_not_found', message, { projectId });
  }
}

function parseToolJson(result: {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}): Record<string, unknown> {
  const text = result.content?.[0]?.text ?? '{}';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (result.isError) {
      throw restErrorFromToolError(parsed);
    }
    return parsed;
  } catch (err) {
    if (err instanceof RestError) {
      throw err;
    }
    if (result.isError) {
      throw new RestError(500, 'handler_error', text);
    }
    throw new RestError(500, 'invalid_handler_response', 'REST handler could not parse tool response');
  }
}

function restErrorFromToolError(payload: Record<string, unknown>): RestError {
  const message = typeof payload.error === 'string'
    ? payload.error
    : 'Request failed';
  const lower = message.toLowerCase();
  let status = 500;
  let code = 'handler_error';

  if (lower.includes('path traversal')) {
    status = 400;
    code = 'unsafe_path';
  } else if (lower.includes('not in the list of tracked documentation paths')) {
    status = 403;
    code = 'untracked_path';
  } else if (lower.includes('not found') || lower.includes('missing')) {
    status = 404;
    code = 'not_found';
  } else if (lower.includes('invalid') || lower.includes('required')) {
    status = 400;
    code = 'invalid_input';
  }

  return new RestError(status, code, message, payload);
}

function ensureRestReadablePath(project: Project, filePath: string): void {
  if (isPathTraversal(filePath)) {
    throw new RestError(
      400,
      'unsafe_path',
      `Path traversal detected: "${filePath}" is outside the project scope`,
      { path: filePath },
    );
  }

  if (!project.policy.isPathProtected(filePath)) {
    throw new RestError(
      403,
      'untracked_path',
      `Path "${filePath}" is not in the list of tracked documentation paths`,
      { path: filePath },
    );
  }
}

function sendRestError(res: express.Response, err: unknown): void {
  if (err instanceof RestError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? {},
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'invalid_input',
        message: 'Invalid request',
        details: { issues: err.issues },
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message,
      details: {},
    },
  });
}

function restReadArgs(
  projectId: string,
  path: string,
  query: express.Request['query'],
): Record<string, unknown> {
  return {
    projectId,
    path,
    branch: getQueryString(query.branch as string | string[] | undefined),
    maxChars: getOptionalPositiveInt(query.maxChars as string | string[] | undefined, 'maxChars'),
    offset: getOptionalNonNegativeInt(query.offset as string | string[] | undefined, 'offset'),
  };
}

function registerReadOnlyRestRoutes(
  app: express.Express,
  rest: RestApiOptions,
): void {
  app.get('/projects', async (_req, res) => {
    try {
      const projects = await rest.listProjects();
      res.json({ projects });
    } catch (err) {
      sendRestError(res, err);
    }
  });

  app.get('/projects/:projectId/status', async (req, res) => {
    try {
      const project = await resolveRestProject(rest, req.params.projectId);
      const data = parseToolJson(await handleStatus(project, {
        projectId: req.params.projectId,
        branch: getQueryString(req.query.branch as string | string[] | undefined),
        maxChars: getOptionalPositiveInt(req.query.maxChars as string | string[] | undefined, 'maxChars'),
      }));
      res.json(data);
    } catch (err) {
      sendRestError(res, err);
    }
  });

  app.get('/projects/:projectId/manifest', async (req, res) => {
    try {
      const project = await resolveRestProject(rest, req.params.projectId);
      const data = parseToolJson(await handleManifest(project, {
        projectId: req.params.projectId,
        branch: getQueryString(req.query.branch as string | string[] | undefined),
        maxDocuments: getOptionalPositiveInt(req.query.maxDocuments as string | string[] | undefined, 'maxDocuments'),
        includeRaw: getOptionalBoolean(req.query.includeRaw as string | string[] | undefined, 'includeRaw'),
        validatePaths: getOptionalBoolean(req.query.validatePaths as string | string[] | undefined, 'validatePaths'),
      }));
      res.json(data);
    } catch (err) {
      sendRestError(res, err);
    }
  });

  app.get(/^\/projects\/([^/]+)\/docs\/(.+)$/, async (req, res) => {
    try {
      const projectId = decodeURIComponent(req.params[0]);
      const docPath = decodeURIComponent(req.params[1]);
      const project = await resolveRestProject(rest, projectId);
      ensureRestReadablePath(project, docPath);
      const data = parseToolJson(await handleRead(project, restReadArgs(projectId, docPath, req.query)));
      res.json(data);
    } catch (err) {
      sendRestError(res, err);
    }
  });

  app.get('/projects/:projectId/sections', async (req, res) => {
    try {
      const project = await resolveRestProject(rest, req.params.projectId);
      const sectionPath = getQueryString(req.query.path as string | string[] | undefined);
      if (sectionPath) {
        ensureRestReadablePath(project, sectionPath);
      }
      const data = parseToolJson(await handleReadSection(project, {
        projectId: req.params.projectId,
        path: sectionPath,
        branch: getQueryString(req.query.branch as string | string[] | undefined),
        revision: getQueryString(req.query.revision as string | string[] | undefined),
        heading: getQueryString(req.query.heading as string | string[] | undefined),
        level: getOptionalPositiveInt(req.query.level as string | string[] | undefined, 'level'),
        occurrence: getOptionalPositiveInt(req.query.occurrence as string | string[] | undefined, 'occurrence'),
        includeHeading: getOptionalBoolean(req.query.includeHeading as string | string[] | undefined, 'includeHeading'),
        maxChars: getOptionalPositiveInt(req.query.maxChars as string | string[] | undefined, 'maxChars'),
        offset: getOptionalNonNegativeInt(req.query.offset as string | string[] | undefined, 'offset'),
      }));
      res.json(data);
    } catch (err) {
      sendRestError(res, err);
    }
  });

  app.post('/projects/:projectId/context-pack', async (req, res) => {
    try {
      const project = await resolveRestProject(rest, req.params.projectId);
      const body = typeof req.body === 'object' && req.body !== null
        ? req.body as Record<string, unknown>
        : {};
      const data = parseToolJson(await handleContextPack(project, {
        ...body,
        projectId: req.params.projectId,
      }));
      res.json(data);
    } catch (err) {
      sendRestError(res, err);
    }
  });
}

// ── HTTP Server ────────────────────────────────────────────────────────

/**
 * Start an HTTP server that wraps an MCP Server with Streamable HTTP transport.
 *
 * The server exposes:
 *   - GET  /health   → { "status": "ok" }
 *   - GET  /projects and read-only project context routes when configured
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

  if (options.rest) {
    registerReadOnlyRestRoutes(app, options.rest);
  }

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
