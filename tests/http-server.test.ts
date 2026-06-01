import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Project } from '../src/core/project.js';
import { Registry } from '../src/core/registry.js';
import { createMcpServer } from '../src/mcp/create-server.js';
import { startHttpServer } from '../src/mcp/http.js';

const PORT = 37376;

async function post(address: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const payload = Buffer.from(JSON.stringify(body));
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: address,
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
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function get(address: string): Promise<{ status: number; data: unknown }> {
  return await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${address}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = chunks.join('').toString();
        let data: unknown;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode ?? 0, data });
      });
    }).on('error', reject);
  });
}

async function options(address: string): Promise<{ status: number; headers: Record<string, string> }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: address,
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Method': 'POST' },
      },
      (res) => {
        const responseHeaders: Record<string, string> = {};
        for (const key of Object.keys(res.headers)) {
          responseHeaders[key] = res.headers[key] as string;
        }
        resolve({ status: res.statusCode ?? 0, headers: responseHeaders });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;

// Isolated temp directories for v0.3 managed storage
const testRoot = path.join(os.tmpdir(), `docu-guard-http-test-${Date.now()}`);
const configDir = path.join(testRoot, 'config');
const dataDir = path.join(testRoot, 'data');
const projectRoot = path.join(testRoot, 'project');

describe('HTTP server', () => {
  beforeAll(async () => {
    await fs.promises.mkdir(projectRoot, { recursive: true });
    await fs.promises.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
    await fs.promises.writeFile(path.join(projectRoot, 'docs', 'README.md'), '# README');

    // Initialize with v0.3 managed storage — no .docu-guard/
    await Project.init({
      projectRoot,
      projectId: 'http-test',
      configDir,
      dataDir,
    });

    // Register in the registry
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('http-test', projectRoot);

    const mcpServer = createMcpServer(async (projectId: string) => {
      const entry = registry.listProjects().find((p) => p.projectId === projectId);
      if (!entry) throw new Error(`Project not found: ${projectId}`);
      return Project.load({
        projectRoot: entry.projectRoot,
        projectId: entry.projectId,
        configDir,
        dataDir,
      });
    }, { version: '0.2.0' });

    const result = await startHttpServer(() => mcpServer, { host: '127.0.0.1', port: PORT });
    server = result.server;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.promises.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('GET /health returns 200 OK', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok' });
  });

  it('OPTIONS /mcp returns CORS headers', async () => {
    const res = await options('/mcp');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
  });

  it('POST /mcp without Content-Type is rejected', async () => {
    const r = await await new Promise<{ status: number; data: unknown }>((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: {} }, (res) => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(chunks.join('').toString()) }); } catch { resolve({ status: res.statusCode ?? 0, data: chunks.join('').toString() }); }
        });
      });
      req.on('error', () => resolve({ status: 0, data: null }));
      req.end();
    });
    expect(r.status).not.toBe(200);
  });

  it('POST /mcp with Content-Type is dispatched', async () => {
    const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(403);
  });

  it('POST /mcp with disallowed Origin returns 403', async () => {
    const r = await new Promise<{ status: number; data: unknown }>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: '/mcp',
          method: 'POST',
          headers: {
            Origin: 'https://evil.example.com',
          },
        },
        (res) => {
          const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
            try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(chunks.join('').toString()) }); } catch { resolve({ status: res.statusCode ?? 0, data: chunks.join('').toString() }); }
          });
        },
      );
      req.on('error', () => resolve({ status: 0, data: null }));
      req.end();
    });
    expect(r.status).toBe(403);
  });

  it('GET to unknown path returns non-200', async () => {
    const r = await await new Promise<{ status: number; data: unknown }>((resolve) => {
      http.get(`http://127.0.0.1:${PORT}/unknown`, (res) => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(chunks.join('').toString()) }); } catch { resolve({ status: res.statusCode ?? 0, data: chunks.join('').toString() }); }
        });
      }).on('error', () => resolve({ status: 0, data: null }));
    });
    expect(r.status).not.toBe(200);
  });

  it('should not create .docu-guard/ in project root', async () => {
    await expect(fs.promises.stat(path.join(projectRoot, '.docu-guard'))).rejects.toThrow();
  });

  it('should have managed state under dataDir', async () => {
    const managedDir = path.join(dataDir, 'projects', 'http-test');
    const managedStat = await fs.promises.stat(managedDir);
    expect(managedStat.isDirectory()).toBe(true);

    const repoPath = path.join(managedDir, 'repo.git');
    const repoStat = await fs.promises.stat(repoPath);
    expect(repoStat.isDirectory()).toBe(true);
  });

  it('should have registry at configDir/projects.json', async () => {
    const registryPath = path.join(configDir, 'projects.json');
    const regStat = await fs.promises.stat(registryPath);
    expect(regStat.isFile()).toBe(true);
  });
});
