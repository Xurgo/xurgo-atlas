import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Project } from '../src/core/project.js';
import { Registry } from '../src/core/registry.js';
import { StoragePaths } from '../src/core/storage.js';
import { createBoundDaemonProjectResolver } from '../src/cli/daemon.js';
import { createMcpServer } from '../src/mcp/create-server.js';

let port = 0;

function requestRaw(body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = chunks.join('').toString();
          let data: unknown;
          try { data = JSON.parse(text); } catch { data = text; }
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let server: http.Server;
let registry: Registry;

// Use dedicated config/data dirs for the test
const testRoot = path.join(os.tmpdir(), `docu-guard-da-test-${Date.now()}`);
const configDir = path.join(testRoot, 'config');
const dataDir = path.join(testRoot, 'data');
const rootA = path.join(testRoot, 'project-a');
const rootB = path.join(testRoot, 'project-b');

describe('Daemon integration', () => {
  beforeAll(async () => {
    // Create project roots and project-facing files
    await fs.promises.mkdir(rootA, { recursive: true });
    await fs.promises.mkdir(path.join(rootA, 'docs'), { recursive: true });
    await fs.promises.writeFile(path.join(rootA, 'docs', 'README.md'), '# Project A');
    // Initialize with managed storage (no .docu-guard/)
    await Project.init({ projectRoot: rootA, projectId: 'project-a', configDir, dataDir });

    await fs.promises.mkdir(rootB, { recursive: true });
    await fs.promises.mkdir(path.join(rootB, 'docs'), { recursive: true });
    await fs.promises.writeFile(path.join(rootB, 'docs', 'README.md'), '# Project B');
    await Project.init({ projectRoot: rootB, projectId: 'project-b', configDir, dataDir });

    // Register in the registry
    registry = await Registry.load(configDir, dataDir);
    await registry.addProject('project-a', rootA);
    await registry.addProject('project-b', rootB);
    await registry.setDefault('project-a');

    server = http.createServer(async (req, res) => {
      const reqUrl = req.url || '/';
      const pathname = reqUrl.startsWith('/') ? reqUrl.split('?')[0] : '/';

      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
        res.setHeader('access-control-allow-headers', 'Content-Type, Accept');
        res.setHeader('access-control-max-age', '86400');
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.method === 'POST' && pathname === '/mcp') {
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) body += chunk;

        let msg: unknown;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid JSON' } }));
          return;
        }

        const message = msg as Record<string, unknown>;
        if (message.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, result: { tools: [{ name: 'docs.read' }, { name: 'docs.list' }] } }));
          return;
        }

        if (message.method === 'tools/call') {
          const params = (message as Record<string, unknown>).params as Record<string, unknown> | undefined;
          const args = (params as Record<string, unknown> | undefined)?.arguments as Record<string, unknown> | undefined;
          const name = params?.name as string | undefined;
          if (name === 'docs.read') {
            const projectId = args?.projectId as string | undefined;
            const resolvedId = projectId || registry.getDefault()?.projectId;
            if (!resolvedId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, error: { code: -32000, message: 'No projectId provided and no default is set' } }));
              return;
            }
            const entry = registry.listProjects().find((p) => p.projectId === resolvedId);
            if (!entry) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, error: { code: -32000, message: `Project '${resolvedId}' not found in registry` } }));
              return;
            }
            const project = await Project.load({ projectRoot: entry.projectRoot, projectId: entry.projectId, configDir, dataDir });
            const relPath = args?.path as string;
            const result = await project.readFile('main', relPath);
            const fileContent = result.content ?? '';
            const revision = result.revision ?? '';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, result: { content: [{ type: 'text', text: JSON.stringify({ projectId: resolvedId, path: relPath, branch: (args as Record<string, unknown> | undefined)?.branch ?? 'main', revision, content: fileContent }) }] } }));
            return;
          }
          if (name === 'docs.list') {
            const projectId = args?.projectId as string | undefined;
            const resolvedId = projectId || registry.getDefault()?.projectId;
            if (!resolvedId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, error: { code: -32000, message: 'No projectId provided and no default is set' } }));
              return;
            }
            const entry = registry.listProjects().find((p) => p.projectId === resolvedId);
            if (!entry) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, error: { code: -32000, message: `Project '${resolvedId}' not found in registry` } }));
              return;
            }
            const project = await Project.load({ projectRoot: entry.projectRoot, projectId: entry.projectId, configDir, dataDir });
            const files = await project.getTrackedFiles();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, result: { content: [{ type: 'text', text: JSON.stringify({ projectId: resolvedId, branch: 'main', files }) }] } }));
            return;
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: (message as Record<string, unknown>).id, error: { code: -32601, message: 'Method not found' } }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve daemon test server address');
    }
    port = address.port;
  }, 30000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.promises.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('resolves explicit projectId and reads docs via mock daemon', async () => {
    const res = await requestRaw({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'docs.read', arguments: { projectId: 'project-a', path: 'docs/README.md', branch: 'main' } },
    });
    expect(res.status).toBe(200);
    const data = res.body as { result?: { content?: Array<{ text?: string }> } };
    const text = data.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.projectId).toBe('project-a');
    expect(parsed.content).toContain('# Project A');
  });

  it('returns error for unknown projectId via mock daemon', async () => {
    const res = await requestRaw({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'docs.read', arguments: { projectId: 'nonexistent', path: 'docs/README.md', branch: 'main' } },
    });
    expect(res.status).toBe(400);
    const data = res.body as { error?: { message?: string } };
    expect(data.error?.message).toContain('not found');
  });

  it('resolves default project when projectId omitted via mock daemon', async () => {
    const res = await requestRaw({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'docs.read', arguments: { path: 'docs/README.md', branch: 'main' } },
    });
    expect(res.status).toBe(200);
    const data = res.body as { result?: { content?: Array<{ text?: string }> } };
    const text = data.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.projectId).toBe('project-a');
  });

  it('lists files for a resolved project via mock daemon', async () => {
    const res = await requestRaw({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'docs.list', arguments: { projectId: 'project-b' } },
    });
    expect(res.status).toBe(200);
    const data = res.body as { result?: { content?: Array<{ text?: string }> } };
    const text = data.result?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.projectId).toBe('project-b');
    expect(Array.isArray(parsed.files)).toBe(true);
  });
});

describe('bound daemon MCP resolver', () => {
  async function withBoundProjects(
    run: (ctx: {
      root: string;
      configDir: string;
      dataDir: string;
      rootA: string;
      rootB: string;
    }) => Promise<void>,
  ): Promise<void> {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-bound-mcp-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const boundRootA = path.join(root, 'project-a');
    const boundRootB = path.join(root, 'project-b');

    try {
      await fs.promises.mkdir(boundRootA, { recursive: true });
      await fs.promises.mkdir(boundRootB, { recursive: true });
      await Project.init({ projectRoot: boundRootA, projectId: 'project-a', configDir, dataDir });
      await Project.init({ projectRoot: boundRootB, projectId: 'project-b', configDir, dataDir });
      await run({ root, configDir, dataDir, rootA: boundRootA, rootB: boundRootB });
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  }

  function getCallToolHandler(server: ReturnType<typeof createMcpServer>) {
    const handlers = (server as unknown as {
      _requestHandlers: Map<string, (request: unknown) => Promise<{
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>>;
    })._requestHandlers;
    const callTool = handlers.get('tools/call');
    expect(callTool).toBeTypeOf('function');
    return callTool!;
  }

  it('serves MCP requests for the daemon-bound project id', async () => {
    await withBoundProjects(async ({ configDir, dataDir, rootA }) => {
      const server = createMcpServer(createBoundDaemonProjectResolver(
        {
          projectId: 'project-a',
          projectRoot: rootA,
          source: 'explicit',
        },
        new StoragePaths({ configDir, dataDir }),
      ));
      const callTool = getCallToolHandler(server);

      const result = await callTool({
        method: 'tools/call',
        params: {
          name: 'docs.list',
          arguments: { projectId: 'project-a', branch: 'main' },
        },
      });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(parsed.projectId).toBe('project-a');
      expect(Array.isArray(parsed.files)).toBe(true);
    });
  });

  it('uses the daemon-bound project when MCP project id is omitted', async () => {
    await withBoundProjects(async ({ configDir, dataDir, rootA }) => {
      const server = createMcpServer(createBoundDaemonProjectResolver(
        {
          projectId: 'project-a',
          projectRoot: rootA,
          source: 'explicit',
        },
        new StoragePaths({ configDir, dataDir }),
      ));
      const callTool = getCallToolHandler(server);

      const result = await callTool({
        method: 'tools/call',
        params: {
          name: 'docs.list',
          arguments: { branch: 'main' },
        },
      });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(parsed.projectId).toBe('project-a');
    });
  });

  it('rejects MCP requests for a different project id than the bound daemon', async () => {
    await withBoundProjects(async ({ configDir, dataDir, rootA }) => {
      const server = createMcpServer(createBoundDaemonProjectResolver(
        {
          projectId: 'project-a',
          projectRoot: rootA,
          source: 'explicit',
        },
        new StoragePaths({ configDir, dataDir }),
      ));
      const callTool = getCallToolHandler(server);

      const result = await callTool({
        method: 'tools/call',
        params: {
          name: 'docs.list',
          arguments: { projectId: 'project-b', branch: 'main' },
        },
      });

      expect(result.isError).toBe(true);
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('bound to project "project-a"');
      expect(text).toContain('current command resolved project "project-b"');
      expect(text).toContain('Stop the existing daemon');
    });
  });
});
