import * as fs from 'node:fs';
import { inspectManagedStorage } from '../core/storage-inspect.js';
import { StoragePaths, type StorageConfig } from '../core/storage.js';
import { Registry } from '../core/registry.js';

// ── Help text ────────────────────────────────────────────────────────────

export function getStatusUsageText(): string {
  return `
Show the current Xurgo Atlas setup status.

USAGE:
  xurgo-atlas status [options]

OPTIONS:
  --config-dir <path>   Config directory (default: ~/.config/xurgo-atlas;
                        overrides XURGO_ATLAS_CONFIG_DIR; legacy roots
                        auto-discovered)
  --data-dir <path>     Data directory (default: ~/.local/share/xurgo-atlas;
                        overrides XURGO_ATLAS_DATA_DIR; legacy roots
                        auto-discovered)

This is a read-only command. It does not create, modify, or delete any files.
It does not start or stop the daemon.

EXAMPLES:
  xurgo-atlas status
  xurgo-atlas status --config-dir /custom/config --data-dir /custom/data
`;
}

export function printStatusUsage(): void {
  console.log(getStatusUsageText());
}

// ── Source label formatting ──────────────────────────────────────────────

function formatSource(source: string): string {
  switch (source) {
    case 'explicit':
      return 'CLI flag';
    case 'env':
      return 'environment variable';
    case 'atlas-default':
      return 'Atlas default';
    case 'legacy-default':
      return 'legacy fallback';
    default:
      return source;
  }
}

// ── Daemon status check (read-only, no port binding) ────────────────────

interface DaemonStatusInfo {
  running: boolean;
  pid: number | null;
  host: string | null;
  port: number | null;
  stale: boolean;
  mcpEndpoint: string | null;
}

function checkDaemonStatus(storage: StoragePaths): DaemonStatusInfo {
  const pidFilePath = storage.daemonPidFilePath();

  try {
    const raw = fs.readFileSync(pidFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const pid = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0
      ? parsed.pid
      : null;

    if (pid === null) {
      return { running: false, pid: null, host: null, port: null, stale: true, mcpEndpoint: null };
    }

    const isRunning = processExists(pid);

    if (isRunning) {
      const host = typeof parsed.host === 'string' ? parsed.host : null;
      const port = typeof parsed.port === 'number' ? parsed.port : null;
      const resolvedHost = host || '127.0.0.1';
      const resolvedPort = port || 3737;
      return {
        running: true,
        pid,
        host: resolvedHost,
        port: resolvedPort,
        stale: false,
        mcpEndpoint: `http://${resolvedHost}:${resolvedPort}/mcp`,
      };
    }

    // Process is not running — stale PID file
    return { running: false, pid, host: null, port: null, stale: true, mcpEndpoint: null };
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      return { running: false, pid: null, host: null, port: null, stale: false, mcpEndpoint: null };
    }
    // Unreadable PID file
    return { running: false, pid: null, host: null, port: null, stale: false, mcpEndpoint: null };
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (isErrno(error, 'EPERM')) {
      return true;
    }
    return false;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

// ── Status command ───────────────────────────────────────────────────────

export async function statusCommand(config: StorageConfig = {}): Promise<void> {
  const report = inspectManagedStorage(config);
  const storage = new StoragePaths(config);

  const lines: string[] = [];

  // Header
  lines.push('Xurgo Atlas setup status');
  lines.push('Mode: read-only (no file changes, no daemon interaction)');
  lines.push('');

  // ── Storage roots ────────────────────────────────────────────────
  lines.push('Storage roots:');
  lines.push(`  config dir: ${report.selected.configDir}`);
  lines.push(`  data dir: ${report.selected.dataDir}`);
  lines.push(`  config source: ${formatSource(report.selected.configSource)}`);
  lines.push(`  data source: ${formatSource(report.selected.dataSource)}`);
  lines.push('');

  // ── Registry ─────────────────────────────────────────────────────
  lines.push('Registry:');
  lines.push(`  path: ${report.selected.registry.path}`);
  lines.push(`  exists: ${report.selected.registry.exists ? 'yes' : 'no'}`);

  // Load registry (read-only — Registry.load returns a default if the
  // file does not exist, without writing anything to disk).
  let registry: Registry | null = null;
  let registryLoadError: string | null = null;
  try {
    registry = await Registry.load(config.configDir, config.dataDir);
  } catch (error: unknown) {
    registryLoadError = error instanceof Error ? error.message : String(error);
  }

  if (registryLoadError) {
    lines.push(`  registered projects: unavailable (read error: ${registryLoadError})`);
  } else if (registry) {
    const projects = registry.listProjects();
    lines.push(`  registered projects: ${projects.length}`);

    const defaultProject = registry.getDefault();
    if (defaultProject) {
      lines.push(`  default project: ${defaultProject.projectId} → ${defaultProject.projectRoot}`);
    }

    // Compact project listing
    if (projects.length > 0) {
      const maxShow = 20;
      const shown = projects.slice(0, maxShow);
      for (const p of shown) {
        const isDefault = defaultProject?.projectId === p.projectId;
        const suffix = isDefault ? ' (default)' : '';
        lines.push(`    - ${p.projectId} → ${p.projectRoot}${suffix}`);
      }
      if (projects.length > maxShow) {
        lines.push(`    ... and ${projects.length - maxShow} more`);
      }
    }
  }
  lines.push('');

  // ── Daemon ───────────────────────────────────────────────────────
  lines.push('Daemon:');
  const daemon = checkDaemonStatus(storage);

  if (daemon.running) {
    lines.push(`  status: running`);
    lines.push(`  PID: ${daemon.pid}`);
    if (daemon.host) lines.push(`  host: ${daemon.host}`);
    if (daemon.port) lines.push(`  port: ${daemon.port}`);
    if (daemon.mcpEndpoint) lines.push(`  MCP endpoint: ${daemon.mcpEndpoint}`);
  } else if (daemon.stale) {
    lines.push(`  status: not running (stale PID file at ${storage.daemonPidFilePath()})`);
  } else {
    lines.push(`  status: not running`);
  }

  // Always show the default MCP endpoint hint so users/agents can find it
  // without knowing the port number.
  lines.push(`  default MCP endpoint: http://127.0.0.1:3737/mcp`);
  lines.push('');

  // ── Storage notes ─────────────────────────────────────────────────
  const notes: string[] = [];

  if (report.bothPresent) {
    notes.push(
      'Both Atlas and legacy docu-guard storage roots appear present. ' +
      'Run `xurgo-atlas storage inspect` for details.',
    );
  }

  if (report.selected.runtime.runtimeDirExists) {
    notes.push('Runtime artifacts exist in the data directory (e.g. old PID or log files).');
  }

  if (report.diagnostics.length > 0) {
    for (const d of report.diagnostics) {
      notes.push(d.message);
    }
  }

  if (notes.length > 0) {
    lines.push('Storage notes:');
    for (const note of notes) {
      lines.push(`  * ${note}`);
    }
  } else {
    lines.push('Storage notes: none.');
  }

  lines.push('');
  lines.push('No files were modified. This command is read-only.');

  console.log(lines.join('\n'));
}
