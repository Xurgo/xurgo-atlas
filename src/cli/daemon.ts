import * as path from 'node:path';
import * as fs from 'node:fs';
import { Project } from '../core/project.js';
import { Registry } from '../core/registry.js';
import { StoragePaths } from '../core/storage.js';
import { createMcpServer } from '../mcp/create-server.js';
import { startHttpServer, closeHttpServer } from '../mcp/http.js';

export interface DaemonOptions {
  host: string;
  port: number;
  configDir?: string;
  dataDir?: string;
  projectId?: string;
  projectRoot?: string;
}

/**
 * Start the docu-guard daemon (HTTP MCP server).
 *
 * The daemon uses the project registry to resolve projectId → Project
 * on each tool/resource request. Projects are cached in memory for
 * the lifetime of the daemon process.
 */
export async function daemonCommand(options: DaemonOptions): Promise<void> {
  // ── Resolve storage paths ─────────────────────────────────────────
  const storage = new StoragePaths({
    configDir: options.configDir,
    dataDir: options.dataDir,
  });

  // Ensure config and data directories exist
  await fs.promises.mkdir(storage.configDir, { recursive: true });
  await fs.promises.mkdir(storage.dataDir, { recursive: true });

  // ── Print binding info ────────────────────────────────────────────
  console.error(
    `docu-guard daemon — config: ${storage.configDir}, data: ${storage.dataDir}`,
  );

  // ── Print warning for non-localhost binding ───────────────────────
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    console.error(
      `WARNING: Binding to ${options.host} makes the MCP server accessible to ` +
        'all machines on the network. This is unsafe without authentication.',
    );
  }

  // ── Optionally register a project on startup ──────────────────────
  if (options.projectId && options.projectRoot) {
    const resolvedRoot = path.resolve(options.projectRoot);
    const registry = await Registry.load(storage.configDir, storage.dataDir);
    await registry.addProject(options.projectId, resolvedRoot);
    console.error(
      `Registered project "${options.projectId}" at ${resolvedRoot}`,
    );
  }

  // ── Project cache ─────────────────────────────────────────────────
  // Cache loaded Project instances by projectId so we don't re-open
  // the SQLite DB and Git store on every tool call.
  const projectCache = new Map<string, Project>();
  let registry: Registry | null = null;

  // Lazy-load the registry when the first resolution is needed
  async function getRegistry(): Promise<Registry> {
    if (!registry) {
      registry = await Registry.load(storage.configDir, storage.dataDir);
    }
    return registry;
  }

  async function resolveProject(projectId: string): Promise<Project> {
    const reg = await getRegistry();

    // Resolve projectId through the registry (handles default fallback)
    const { projectId: resolvedId, projectRoot } = await reg.resolveOrFallback(projectId);

    // Check cache
    if (projectCache.has(resolvedId)) {
      return projectCache.get(resolvedId)!;
    }

    // Load and cache the project
    const project = await Project.load({
      projectRoot,
      projectId: resolvedId,
      configDir: storage.configDir,
      dataDir: storage.dataDir,
    });
    projectCache.set(resolvedId, project);
    return project;
  }

   // ── Create the MCP server factory with the project resolver ───────────────
   const createMcpServerForRequest = () => createMcpServer(resolveProject, { version: '0.2.0' });

   // ── Start the HTTP server ─────────────────────────────────────────
   const { server } = await startHttpServer(createMcpServerForRequest, {
     host: options.host,
     port: options.port,
   });

  console.error(
    `docu-guard daemon listening on http://${options.host}:${options.port}/mcp`,
  );
  console.error('Press Ctrl+C to stop.');

   // ── Graceful shutdown ─────────────────────────────────────────────
   const shutdown = async () => {
     console.error('\nShutting down...');
     await closeHttpServer(server);
     process.exit(0);
   };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  await new Promise<void>(() => {});
}
