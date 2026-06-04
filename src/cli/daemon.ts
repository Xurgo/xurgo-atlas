import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Project } from '../core/project.js';
import { Registry } from '../core/registry.js';
import { StoragePaths } from '../core/storage.js';
import { createMcpServer } from '../mcp/create-server.js';
import { startHttpServer, closeHttpServer } from '../mcp/http.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3737;
const DAEMON_START_TIMEOUT_MS = 5000;
const DAEMON_STOP_TIMEOUT_MS = 5000;
const DAEMON_POLL_INTERVAL_MS = 100;

export type DaemonAction = 'foreground' | 'start' | 'stop' | 'status';

export interface DaemonOptions {
  action?: string;
  host: string;
  port: number;
  configDir?: string;
  dataDir?: string;
  projectId?: string;
  projectRoot?: string;
  pidFile?: string;
}

export interface DaemonPidFile {
  pid: number;
  host: string;
  port: number;
  configDir: string;
  dataDir: string;
  projectId?: string;
  projectRoot?: string;
  startedAt: string;
}

interface ResolvedDaemonOptions {
  action: DaemonAction;
  host: string;
  port: number;
  configDir?: string;
  dataDir?: string;
  projectId?: string;
  projectRoot?: string;
  pidFile?: string;
}

export interface DaemonCommandDeps {
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => Pick<ChildProcess, 'pid' | 'unref'>;
  isProcessRunning?: (pid: number) => boolean;
  signalProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
  sleep?: (ms: number) => Promise<void>;
}

export function getDaemonUsageText(): string {
  return `
Manage the Xurgo Atlas daemon (HTTP MCP server).

USAGE:
  xurgo-atlas daemon [options]
  xurgo-atlas daemon start [options]
  xurgo-atlas daemon stop [options]
  xurgo-atlas daemon status [options]

MODES:
  [no subcommand]        Start the daemon in foreground mode
  start                  Start the daemon in the background
  stop                   Stop the background daemon
  status                 Show background daemon status

OPTIONS:
  --host <host>          Host to bind to (default: 127.0.0.1)
  --port <port>          Port to listen on (default: 3737)
  --config-dir <path>    Config directory override
  --data-dir <path>      Data directory override
  --project-id <id>      Optional: register a project on startup
  --project-root <path>  Optional: project root (used with --project-id)

EXAMPLES:
  xurgo-atlas daemon
  xurgo-atlas daemon --host 127.0.0.1 --port 3737
  xurgo-atlas daemon start
  xurgo-atlas daemon status
`;
}

const defaultDeps: Required<DaemonCommandDeps> = {
  spawnProcess: (command, args, options) => spawn(command, args, options),
  isProcessRunning: processExists,
  signalProcess: (pid, signal) => {
    process.kill(pid, signal);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function resolveDaemonAction(action?: string): DaemonAction {
  if (!action) return 'foreground';
  if (action === 'start' || action === 'stop' || action === 'status') {
    return action;
  }
  throw new Error(`Unknown daemon subcommand: "${action}"`);
}

export function getDaemonPidFilePath(storage: StoragePaths): string {
  return storage.daemonPidFilePath();
}

export function buildBackgroundDaemonArgs(
  options: ResolvedDaemonOptions,
  pidFile: string,
): string[] {
  const args = ['daemon', '--host', options.host, '--port', String(options.port), '--pid-file', pidFile];

  if (options.configDir) {
    args.push('--config-dir', options.configDir);
  }
  if (options.dataDir) {
    args.push('--data-dir', options.dataDir);
  }
  if (options.projectId) {
    args.push('--project-id', options.projectId);
  }
  if (options.projectRoot) {
    args.push('--project-root', options.projectRoot);
  }

  return args;
}

export async function daemonCommand(
  options: DaemonOptions,
  deps: DaemonCommandDeps = {},
): Promise<void> {
  const resolved = normalizeOptions(options);
  const runtime = { ...defaultDeps, ...deps };
  const storage = new StoragePaths({
    configDir: resolved.configDir,
    dataDir: resolved.dataDir,
  });

  await ensureStorageDirs(storage);

  const pidFile = resolved.pidFile
    ? path.resolve(resolved.pidFile)
    : getDaemonPidFilePath(storage);

  switch (resolved.action) {
    case 'foreground':
      await runForegroundDaemon(resolved, storage, pidFile);
      break;
    case 'start':
      await startBackgroundDaemon(resolved, storage, pidFile, runtime);
      break;
    case 'stop':
      await stopBackgroundDaemon(pidFile, runtime);
      break;
    case 'status':
      await printDaemonStatus(pidFile, runtime);
      break;
  }
}

async function runForegroundDaemon(
  options: ResolvedDaemonOptions,
  storage: StoragePaths,
  pidFile: string,
): Promise<void> {
  console.error(
    `xurgo-atlas daemon — config: ${storage.configDir}, data: ${storage.dataDir}`,
  );

  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    console.error(
      `WARNING: Binding to ${options.host} makes the MCP server accessible to ` +
        'all machines on the network. This is unsafe without authentication.',
    );
  }

  if (options.projectId && options.projectRoot) {
    const resolvedRoot = path.resolve(options.projectRoot);
    const registry = await Registry.load(storage.configDir, storage.dataDir);
    await registry.addProject(options.projectId, resolvedRoot);
    console.error(
      `Registered project "${options.projectId}" at ${resolvedRoot}`,
    );
  }

  const projectCache = new Map<string, Project>();
  let registry: Registry | null = null;

  async function getRegistry(): Promise<Registry> {
    if (!registry) {
      registry = await Registry.load(storage.configDir, storage.dataDir);
    }
    return registry;
  }

  async function resolveProject(projectId: string): Promise<Project> {
    const reg = await getRegistry();
    const resolvedProject = await reg.resolveOrFallback(projectId);

    if (projectCache.has(resolvedProject.projectId)) {
      return projectCache.get(resolvedProject.projectId)!;
    }

    const project = await Project.load({
      projectRoot: resolvedProject.projectRoot,
      projectId: resolvedProject.projectId,
      configDir: storage.configDir,
      dataDir: storage.dataDir,
    });
    projectCache.set(resolvedProject.projectId, project);
    return project;
  }

  const createMcpServerForRequest = () =>
    createMcpServer(resolveProject, { version: '0.2.0' });

  const { server } = await startHttpServer(createMcpServerForRequest, {
    host: options.host,
    port: options.port,
    rest: {
      resolveProject,
      listProjects: async () => {
        const reg = await getRegistry();
        const defaultProject = reg.getDefault();
        return reg.listProjects().map((project) => ({
          projectId: project.projectId,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          default: defaultProject?.projectId === project.projectId,
        }));
      },
    },
  });

  await writeDaemonPidFile(pidFile, {
    pid: process.pid,
    host: options.host,
    port: options.port,
    configDir: storage.configDir,
    dataDir: storage.dataDir,
    projectId: options.projectId,
    projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : undefined,
    startedAt: new Date().toISOString(),
  });

  process.on('exit', () => {
    removeOwnedPidFileSync(pidFile, process.pid);
  });

  console.error(
    `xurgo-atlas daemon listening on http://${options.host}:${options.port}/mcp`,
  );
  console.error('Press Ctrl+C to stop.');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error('\nShutting down...');
    await closeHttpServer(server);
    await removeOwnedPidFile(pidFile, process.pid);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise<void>(() => {});
}

async function startBackgroundDaemon(
  options: ResolvedDaemonOptions,
  storage: StoragePaths,
  pidFile: string,
  deps: Required<DaemonCommandDeps>,
): Promise<void> {
  const staleState = await inspectDaemonState(pidFile, deps.isProcessRunning);
  if (staleState.running && staleState.info) {
    console.log(
      `xurgo-atlas daemon is already running (pid ${staleState.info.pid}) at ${formatDaemonUrl(staleState.info)}.`,
    );
    return;
  }
  if (staleState.stale) {
    await removePidFile(pidFile);
  }

  await fs.promises.mkdir(path.dirname(pidFile), { recursive: true });
  const logPath = getDaemonLogPath(pidFile);
  const outputFd = fs.openSync(logPath, 'a');
  const commandArgs = buildBackgroundDaemonArgs(options, pidFile);
  const cliEntry = fileURLToPath(new URL('../index.js', import.meta.url));
  const child = deps.spawnProcess(
    process.execPath,
    [cliEntry, ...commandArgs],
    {
      detached: true,
      stdio: ['ignore', outputFd, outputFd],
      windowsHide: true,
    },
  );

  fs.closeSync(outputFd);

  if (!child.pid) {
    throw new Error('Failed to launch the background daemon process.');
  }

  child.unref();

  try {
    const info = await waitForDaemonStart(pidFile, child.pid, deps);
    console.log(`Started xurgo-atlas daemon at ${formatDaemonUrl(info)}.`);
  } catch (error) {
    if (deps.isProcessRunning(child.pid)) {
      try {
        deps.signalProcess(child.pid, 'SIGTERM');
      } catch {
        // Ignore cleanup errors here; stale PID handling covers the next run.
      }
    }
    await removeStalePidFile(pidFile, deps.isProcessRunning);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} See ${logPath} for daemon output.`);
  }
}

async function stopBackgroundDaemon(
  pidFile: string,
  deps: Required<DaemonCommandDeps>,
): Promise<void> {
  const state = await inspectDaemonState(pidFile, deps.isProcessRunning);
  if (!state.info) {
    console.log('xurgo-atlas daemon is not running.');
    return;
  }
  if (state.stale) {
    await removePidFile(pidFile);
    console.log(`xurgo-atlas daemon is not running. Removed stale PID file at ${pidFile}.`);
    return;
  }

  deps.signalProcess(state.info.pid, 'SIGTERM');
  const stopped = await waitForProcessExit(state.info.pid, deps, DAEMON_STOP_TIMEOUT_MS);
  if (!stopped) {
    throw new Error(`Timed out waiting for daemon process ${state.info.pid} to stop.`);
  }

  await removeOwnedPidFile(pidFile, state.info.pid);
  console.log(`Stopped xurgo-atlas daemon (pid ${state.info.pid}).`);
}

async function printDaemonStatus(
  pidFile: string,
  deps: Required<DaemonCommandDeps>,
): Promise<void> {
  const state = await inspectDaemonState(pidFile, deps.isProcessRunning);

  if (state.running && state.info) {
    console.log(
      `xurgo-atlas daemon is running (pid ${state.info.pid}) at ${formatDaemonUrl(state.info)}.`,
    );
    return;
  }

  if (state.stale) {
    await removePidFile(pidFile);
    console.log(`xurgo-atlas daemon is not running. Removed stale PID file at ${pidFile}.`);
    return;
  }

  console.log('xurgo-atlas daemon is not running.');
}

async function waitForDaemonStart(
  pidFile: string,
  childPid: number,
  deps: Required<DaemonCommandDeps>,
): Promise<DaemonPidFile> {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const state = await inspectDaemonState(pidFile, deps.isProcessRunning);
    if (state.running && state.info?.pid === childPid) {
      return state.info;
    }
    if (!deps.isProcessRunning(childPid)) {
      break;
    }
    await deps.sleep(DAEMON_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for the daemon to start.');
}

async function waitForProcessExit(
  pid: number,
  deps: Required<DaemonCommandDeps>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!deps.isProcessRunning(pid)) {
      return true;
    }
    await deps.sleep(DAEMON_POLL_INTERVAL_MS);
  }
  return !deps.isProcessRunning(pid);
}

async function inspectDaemonState(
  pidFile: string,
  isProcessRunning: (pid: number) => boolean,
): Promise<{ running: boolean; stale: boolean; info: DaemonPidFile | null }> {
  const info = await readDaemonPidFile(pidFile);
  if (!info) {
    return { running: false, stale: false, info: null };
  }
  if (!Number.isInteger(info.pid) || info.pid <= 0) {
    return { running: false, stale: true, info };
  }
  if (isProcessRunning(info.pid)) {
    return { running: true, stale: false, info };
  }
  return { running: false, stale: true, info };
}

async function readDaemonPidFile(pidFile: string): Promise<DaemonPidFile | null> {
  try {
    const raw = await fs.promises.readFile(pidFile, 'utf-8');
    return JSON.parse(raw) as DaemonPidFile;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

async function writeDaemonPidFile(
  pidFile: string,
  payload: DaemonPidFile,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(pidFile), { recursive: true });
  const tempFile = `${pidFile}.tmp`;
  await fs.promises.writeFile(
    tempFile,
    JSON.stringify(payload, null, 2) + '\n',
    'utf-8',
  );
  await fs.promises.rename(tempFile, pidFile);
}

async function removePidFile(pidFile: string): Promise<void> {
  try {
    await fs.promises.unlink(pidFile);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) {
      throw error;
    }
  }
}

async function removeOwnedPidFile(pidFile: string, pid: number): Promise<void> {
  const info = await readDaemonPidFile(pidFile);
  if (info?.pid === pid) {
    await removePidFile(pidFile);
  }
}

function removeOwnedPidFileSync(pidFile: string, pid: number): void {
  try {
    const raw = fs.readFileSync(pidFile, 'utf-8');
    const info = JSON.parse(raw) as DaemonPidFile;
    if (info.pid === pid) {
      fs.unlinkSync(pidFile);
    }
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) {
      throw error;
    }
  }
}

async function removeStalePidFile(
  pidFile: string,
  isProcessRunning: (pid: number) => boolean,
): Promise<void> {
  const state = await inspectDaemonState(pidFile, isProcessRunning);
  if (!state.running && state.info) {
    await removePidFile(pidFile);
  }
}

export function getDaemonLogPath(pidFile: string): string {
  return path.join(path.dirname(pidFile), 'xurgo-atlas-daemon.log');
}

function formatDaemonUrl(info: Pick<DaemonPidFile, 'host' | 'port'>): string {
  return `http://${info.host}:${info.port}/mcp`;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error, 'EPERM')) {
      return true;
    }
    return false;
  }
}

async function ensureStorageDirs(storage: StoragePaths): Promise<void> {
  await fs.promises.mkdir(storage.configDir, { recursive: true });
  await fs.promises.mkdir(storage.dataDir, { recursive: true });
}

function normalizeOptions(options: DaemonOptions): ResolvedDaemonOptions {
  return {
    action: resolveDaemonAction(options.action),
    host: options.host || DEFAULT_HOST,
    port: options.port || DEFAULT_PORT,
    configDir: options.configDir,
    dataDir: options.dataDir,
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    pidFile: options.pidFile,
  };
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
