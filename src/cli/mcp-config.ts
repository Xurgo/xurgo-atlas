import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectContext, ProjectResolutionError } from '../core/project-resolution.js';
import { Registry } from '../core/registry.js';
import { inspectGitIdentity, normalizeExistingPath } from '../core/git-identity.js';
import { computeRootMismatch } from '../core/root-safety.js';

// ── MCP config guidance (read-only) ──────────────────────────────────────

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3737;
const SERVER_NAME = 'xurgo-atlas';
const DISPLAY_NAME = 'Xurgo Atlas';
const TRANSPORT = 'streamable-http';

export interface McpConfigOptions {
  host?: string;
  port?: number;
  json?: boolean;
  projectRoot?: string;
  configDir?: string;
  dataDir?: string;
  cwd?: string;
}

export function getMcpConfigUsageText(): string {
  return `
Print MCP client connection guidance for Xurgo Atlas.

USAGE:
  xurgo-atlas mcp-config [options]

OPTIONS:
  --host <host>    MCP server host (default: 127.0.0.1)
  --port <port>    MCP server port (default: 3737)
  --json           Print output as machine-readable JSON only

This is a read-only command. It does not create, modify, or delete any files.
It does not start or stop the daemon.
It does not require a project to be initialized.

EXAMPLES:
  xurgo-atlas mcp-config
  xurgo-atlas mcp-config --host 0.0.0.0 --port 3737
  xurgo-atlas mcp-config --json
`;
}

export function printMcpConfigUsage(): void {
  console.log(getMcpConfigUsageText());
}

interface McpProjectContext {
  projectId: string | null;
  projectRoot: string | null;
  projectSource: string | null;
  registeredProjectRoot: string | null;
  cwd: string;
  git: Awaited<ReturnType<typeof inspectGitIdentity>>;
  safety: McpSafetySummary;
}

interface McpJsonConfig {
  serverName: string;
  displayName: string;
  transport: string;
  url: string;
  projectId: string | null;
  projectRoot: string | null;
  projectSource: string | null;
  requestedCwd: string;
  registeredProjectRoot: string | null;
  git: Awaited<ReturnType<typeof inspectGitIdentity>>;
  safety: McpSafetySummary;
  startCommand: {
    command: string;
    args: string[];
  };
  mcpServers: {
    'xurgo-atlas': {
      url: string;
    };
  };
}

interface McpSafetySummary {
  safeForWrites: boolean;
  rootMismatch: boolean;
  ambiguous: boolean;
  markerMissing: boolean;
  markerMismatch: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
  warnings: string[];
}

async function resolveMcpProjectContext(
  options: McpConfigOptions,
): Promise<McpProjectContext> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await Registry.load(options.configDir, options.dataDir);
  const git = await inspectGitIdentity(cwd);

  try {
    const resolved = await resolveProjectContext({
      projectRoot: options.projectRoot,
      configDir: options.configDir,
      dataDir: options.dataDir,
      cwd: options.cwd,
    });
    const registeredProjectRoot = registry.getProject(resolved.projectId)?.projectRoot ?? null;
    const registeredProjectRootMismatch = registeredProjectRoot
      ? !comparePaths(registeredProjectRoot, resolved.projectRoot)
      : false;
    const gitMismatch = git.insideWorkTree
      ? !comparePaths(git.worktreeRoot, resolved.projectRoot)
      : false;
    const markerState = await inspectMarkerState(resolved.projectRoot, resolved.projectId);
    const safety = buildMcpSafetySummary({
      markerMissing: markerState.markerMissing,
      markerMismatch: markerState.markerMismatch,
      registeredProjectRootMissing: registeredProjectRoot === null,
      registeredProjectRootMismatch,
      daemonProjectRootMismatch: false,
      gitMismatch,
      gitUnavailable: !git.insideWorkTree,
    });
    const rootMismatch = computeRootMismatch({
      registeredProjectRootMismatch,
      gitMismatch,
    });
    return {
      projectId: resolved.projectId,
      projectRoot: resolved.projectRoot,
      projectSource: resolved.source,
      registeredProjectRoot,
      cwd,
      git,
      safety: {
        ...safety,
        rootMismatch,
      },
    };
  } catch (error: unknown) {
    if (error instanceof ProjectResolutionError) {
      const safety = buildMcpSafetySummary({
        markerMissing: true,
        markerMismatch: false,
        registeredProjectRootMissing: true,
        registeredProjectRootMismatch: false,
        daemonProjectRootMismatch: false,
        gitMismatch: false,
        gitUnavailable: !git.insideWorkTree,
      });
      return {
        projectId: null,
        projectRoot: null,
        projectSource: null,
        registeredProjectRoot: null,
        cwd,
        git,
        safety: {
          ...safety,
          rootMismatch: false,
        },
      };
    }
    throw error;
  }
}

function buildMcpJsonConfig(
  endpoint: string,
  project: McpProjectContext,
): McpJsonConfig {
  return {
    serverName: SERVER_NAME,
    displayName: DISPLAY_NAME,
    transport: TRANSPORT,
    url: endpoint,
    projectId: project.projectId,
    projectRoot: project.projectRoot,
    projectSource: project.projectSource,
    requestedCwd: project.cwd,
    registeredProjectRoot: project.registeredProjectRoot,
    git: project.git,
    safety: project.safety,
    startCommand: {
      command: 'xurgo-atlas',
      args: ['daemon', 'start'],
    },
    mcpServers: {
      'xurgo-atlas': {
        url: endpoint,
      },
    },
  };
}

function comparePaths(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = normalizeExistingPath(left);
  const normalizedRight = normalizeExistingPath(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

export async function getMcpConfigOutput(options: McpConfigOptions): Promise<string> {
  const host = options.host || DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const endpoint = `http://${host}:${port}/mcp`;
  const project = await resolveMcpProjectContext(options);
  const jsonConfig = buildMcpJsonConfig(endpoint, project);

  if (options.json) {
    return JSON.stringify(jsonConfig, null, 2);
  }

  return [
    `Xurgo Atlas MCP client configuration`,
    '',
    `Endpoint:`,
      `  ${endpoint}`,
    '',
    `Project binding:`,
    `  cwd: ${project.cwd}`,
    `  project: ${project.projectId ?? 'unresolved'}${project.projectRoot ? ` -> ${project.projectRoot}` : ''}`,
    `  source: ${project.projectSource ?? 'unresolved'}`,
    `  registered root: ${project.registeredProjectRoot ?? 'unresolved'}`,
    `  git worktree: ${project.git.worktreeRoot ?? 'unavailable'}`,
    `  git common dir: ${project.git.commonDir ?? 'unavailable'}`,
    `  git branch: ${project.git.branch ?? 'detached or unavailable'}`,
    `  git HEAD: ${project.git.head ?? 'unavailable'}`,
    `  safe for writes: ${project.safety.safeForWrites ? 'yes' : 'no'}`,
    '',
    `Generic MCP client JSON:`,
    JSON.stringify(jsonConfig, null, 2),
    '',
    `Notes:`,
    `- Start the daemon first with: xurgo-atlas daemon start`,
    `- For machine-readable setup, prefer: xurgo-atlas mcp-config --json`,
    `- This command is read-only and does not write client config files.`,
  ].join('\n');
}

export async function mcpConfigCommand(options: McpConfigOptions = {}): Promise<void> {
  console.log(await getMcpConfigOutput(options));
}

async function inspectMarkerState(
  projectRoot: string | null,
  projectId: string | null,
): Promise<{ markerMissing: boolean; markerMismatch: boolean }> {
  if (!projectRoot) {
    return { markerMissing: true, markerMismatch: false };
  }

  const markerPath = path.join(projectRoot, '.xurgo-atlas', 'project.json');

  try {
    const raw = await fs.promises.readFile(markerPath, 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: unknown } | null;
    if (!parsed || typeof parsed.projectId !== 'string') {
      return { markerMissing: true, markerMismatch: false };
    }

    return {
      markerMissing: false,
      markerMismatch: projectId !== null && parsed.projectId !== projectId,
    };
  } catch {
    return { markerMissing: true, markerMismatch: false };
  }
}

function buildMcpSafetySummary(signals: {
  markerMissing: boolean;
  markerMismatch: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
}): McpSafetySummary {
  const rootMismatch = computeRootMismatch({
    markerMismatch: signals.markerMismatch,
    registeredProjectRootMismatch: signals.registeredProjectRootMismatch,
    daemonProjectRootMismatch: signals.daemonProjectRootMismatch,
    gitMismatch: signals.gitMismatch,
  });
  const ambiguous =
    signals.markerMissing ||
    signals.markerMismatch ||
    signals.registeredProjectRootMissing ||
    signals.registeredProjectRootMismatch ||
    signals.daemonProjectRootMismatch ||
    signals.gitMismatch;
  const safeForWrites =
    !signals.markerMissing &&
    !signals.markerMismatch &&
    !signals.registeredProjectRootMissing &&
    !signals.registeredProjectRootMismatch &&
    !signals.daemonProjectRootMismatch &&
    !signals.gitMismatch;

  return {
    safeForWrites,
    rootMismatch,
    ambiguous,
    markerMissing: signals.markerMissing,
    markerMismatch: signals.markerMismatch,
    registeredProjectRootMissing: signals.registeredProjectRootMissing,
    registeredProjectRootMismatch: signals.registeredProjectRootMismatch,
    daemonProjectRootMismatch: signals.daemonProjectRootMismatch,
    gitMismatch: signals.gitMismatch,
    gitUnavailable: signals.gitUnavailable,
    warnings: buildMcpSafetyWarnings(signals),
  };
}

function buildMcpSafetyWarnings(signals: {
  markerMissing: boolean;
  markerMismatch: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
}): string[] {
  const warnings: string[] = [];
  if (signals.markerMissing) {
    warnings.push('missing local project marker');
  }
  if (signals.markerMismatch) {
    warnings.push('marker project id mismatch');
  }
  if (signals.registeredProjectRootMissing) {
    warnings.push('registered project root missing');
  }
  if (signals.registeredProjectRootMismatch) {
    warnings.push('registered project root mismatch');
  }
  if (signals.daemonProjectRootMismatch) {
    warnings.push('daemon-bound root mismatch');
  }
  if (signals.gitMismatch) {
    warnings.push('git worktree mismatch');
  }
  if (signals.gitUnavailable) {
    warnings.push('git identity unavailable');
  }
  return warnings;
}
