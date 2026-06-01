import * as path from 'node:path';
import * as os from 'node:os';

// ── Tilde expansion ──────────────────────────────────────────────────

/**
 * Expand a leading `~` or `~/` to the current user's home directory.
 * Non-tilde paths are returned as-is.
 *
 * This is needed because Node's path.resolve() does not expand tilde,
 * and shell expansion is not guaranteed (e.g. when called programmatically).
 */
export function expandTilde(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// ── Storage path configuration ─────────────────────────────────────────

export interface StorageConfig {
  configDir?: string;
  dataDir?: string;
}

/**
 * Centralised path resolution for docu-guard managed storage.
 *
 * All daemon-managed state lives under the configured data directory.
 * Configuration (registry) lives under the configured config directory.
 */
export class StoragePaths {
  public readonly configDir: string;
  public readonly dataDir: string;

  constructor(config?: StorageConfig) {
    this.configDir = config?.configDir != null
      ? path.resolve(expandTilde(config.configDir))
      : getDefaultConfigDir();
    this.dataDir = config?.dataDir != null
      ? path.resolve(expandTilde(config.dataDir))
      : getDefaultDataDir();
  }

  /** Path to the project registry file. */
  registryPath(): string {
    return path.join(this.configDir, 'projects.json');
  }

  /** Root directory for a project's managed state. */
  projectDataDir(projectId: string): string {
    return path.join(this.dataDir, 'projects', projectId);
  }

  /** Git bare repo for a project's docs history. */
  projectRepoPath(projectId: string): string {
    return path.join(this.projectDataDir(projectId), 'repo.git');
  }

  /** SQLite database for a project's events and proposals. */
  projectEventsPath(projectId: string): string {
    return path.join(this.projectDataDir(projectId), 'events.sqlite');
  }
}

/**
 * Default config directory follows XDG_CONFIG_HOME, falling back to
 * ~/.config/docu-guard.
 */
export function getDefaultConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, 'docu-guard');
  }
  return path.join(os.homedir(), '.config', 'docu-guard');
}

/**
 * Default data directory follows XDG_DATA_HOME, falling back to
 * ~/.local/share/docu-guard.
 */
export function getDefaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    return path.join(xdg, 'docu-guard');
  }
  return path.join(os.homedir(), '.local', 'share', 'docu-guard');
}
