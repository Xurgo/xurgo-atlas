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

export interface StorageRootCandidates {
  atlasConfigDir: string;
  atlasDataDir: string;
  legacyConfigDir: string;
  legacyDataDir: string;
}

export interface ResolvedStorageRoots {
  configDir: string;
  dataDir: string;
  configSource: 'explicit' | 'legacy-default';
  dataSource: 'explicit' | 'legacy-default';
  candidates: StorageRootCandidates;
}

/**
 * Normalize a storage root from CLI/config input into an absolute path.
 */
export function normalizeStorageRoot(root: string): string {
  return path.resolve(expandTilde(root));
}

function resolveXdgAppRoot(
  xdgHome: string | undefined,
  fallbackSegments: string[],
  appName: string,
): string {
  if (xdgHome) {
    return path.join(xdgHome, appName);
  }
  return path.join(os.homedir(), ...fallbackSegments, appName);
}

/**
 * Return the atlas and legacy storage-root candidates without choosing
 * between them. The current slice still selects legacy defaults unless
 * explicit overrides are supplied.
 */
export function getStorageRootCandidates(): StorageRootCandidates {
  return {
    atlasConfigDir: resolveXdgAppRoot(
      process.env.XDG_CONFIG_HOME,
      ['.config'],
      'xurgo-atlas',
    ),
    atlasDataDir: resolveXdgAppRoot(
      process.env.XDG_DATA_HOME,
      ['.local', 'share'],
      'xurgo-atlas',
    ),
    legacyConfigDir: resolveXdgAppRoot(
      process.env.XDG_CONFIG_HOME,
      ['.config'],
      'docu-guard',
    ),
    legacyDataDir: resolveXdgAppRoot(
      process.env.XDG_DATA_HOME,
      ['.local', 'share'],
      'docu-guard',
    ),
  };
}

/**
 * Resolve the effective config/data roots for the current process.
 *
 * This slice preserves the current legacy defaults. Atlas-named roots are
 * exposed as candidates for a later migration step, but are not selected
 * automatically yet.
 */
export function resolveStorageRoots(config: StorageConfig = {}): ResolvedStorageRoots {
  const candidates = getStorageRootCandidates();

  return {
    configDir: config.configDir != null
      ? normalizeStorageRoot(config.configDir)
      : candidates.legacyConfigDir,
    dataDir: config.dataDir != null
      ? normalizeStorageRoot(config.dataDir)
      : candidates.legacyDataDir,
    configSource: config.configDir != null ? 'explicit' : 'legacy-default',
    dataSource: config.dataDir != null ? 'explicit' : 'legacy-default',
    candidates,
  };
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
    const roots = resolveStorageRoots(config);
    this.configDir = roots.configDir;
    this.dataDir = roots.dataDir;
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
  return resolveStorageRoots().configDir;
}

/**
 * Default data directory follows XDG_DATA_HOME, falling back to
 * ~/.local/share/docu-guard.
 */
export function getDefaultDataDir(): string {
  return resolveStorageRoots().dataDir;
}
