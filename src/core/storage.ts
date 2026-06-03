import * as fs from 'node:fs';
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

export interface StorageNamespaceState {
  configDir: string;
  dataDir: string;
  registryPath: string;
  registryExists: boolean;
  dataDirExists: boolean;
  dataDirPopulated: boolean;
  present: boolean;
}

export interface StorageDiscoveryState {
  atlas: StorageNamespaceState;
  legacy: StorageNamespaceState;
  selectedDefaultApp: 'atlas' | 'legacy';
}

export interface StorageDiagnostic {
  code: 'both-storage-roots-populated';
  level: 'warning';
  message: string;
}

export interface ResolvedStorageRoots {
  configDir: string;
  dataDir: string;
  configSource: 'explicit' | 'atlas-default' | 'legacy-default';
  dataSource: 'explicit' | 'atlas-default' | 'legacy-default';
  candidates: StorageRootCandidates;
  discovery: StorageDiscoveryState;
  diagnostics: StorageDiagnostic[];
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
 * between them.
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

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function isPopulatedDirectory(dirPath: string): boolean {
  if (!isDirectory(dirPath)) {
    return false;
  }

  try {
    return fs.readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

function inspectNamespaceState(
  configDir: string,
  dataDir: string,
): StorageNamespaceState {
  const registryPath = path.join(configDir, 'projects.json');
  const registryExists = isFile(registryPath);
  const dataDirExists = isDirectory(dataDir);
  const dataDirPopulated = isPopulatedDirectory(dataDir);

  return {
    configDir,
    dataDir,
    registryPath,
    registryExists,
    dataDirExists,
    dataDirPopulated,
    present: registryExists || dataDirPopulated,
  };
}

export function inspectStorageDiscovery(
  candidates: StorageRootCandidates = getStorageRootCandidates(),
): StorageDiscoveryState {
  const atlas = inspectNamespaceState(
    candidates.atlasConfigDir,
    candidates.atlasDataDir,
  );
  const legacy = inspectNamespaceState(
    candidates.legacyConfigDir,
    candidates.legacyDataDir,
  );

  return {
    atlas,
    legacy,
    selectedDefaultApp: atlas.present ? 'atlas' : legacy.present ? 'legacy' : 'atlas',
  };
}

function buildStorageDiagnostics(
  discovery: StorageDiscoveryState,
): StorageDiagnostic[] {
  if (!(discovery.atlas.present && discovery.legacy.present)) {
    return [];
  }

  return [
    {
      code: 'both-storage-roots-populated',
      level: 'warning',
      message:
        'Both Xurgo Atlas and legacy docu-guard storage roots appear populated. ' +
        `Using Xurgo Atlas roots (${discovery.atlas.configDir}, ${discovery.atlas.dataDir}) ` +
        `and leaving legacy roots unchanged (${discovery.legacy.configDir}, ${discovery.legacy.dataDir}). ` +
        'No automatic merge or migration was performed. Use --config-dir/--data-dir to target a specific root explicitly.',
    },
  ];
}

export function emitStorageDiagnostics(
  resolved: Pick<ResolvedStorageRoots, 'diagnostics'>,
  logger: Pick<Console, 'warn'> = console,
): void {
  for (const diagnostic of resolved.diagnostics) {
    logger.warn(`Warning: ${diagnostic.message}`);
  }
}

/**
 * Resolve the effective config/data roots for the current process.
 *
 * Explicit overrides always win. Otherwise, atlas-named roots are preferred
 * when present, legacy roots are discovered for backward compatibility, and
 * fresh installs default to atlas-named roots.
 */
export function resolveStorageRoots(config: StorageConfig = {}): ResolvedStorageRoots {
  const candidates = getStorageRootCandidates();
  const discovery = inspectStorageDiscovery(candidates);
  const selectedDefaultRoots = discovery.selectedDefaultApp === 'atlas'
    ? {
        configDir: candidates.atlasConfigDir,
        dataDir: candidates.atlasDataDir,
        source: 'atlas-default' as const,
      }
    : {
        configDir: candidates.legacyConfigDir,
        dataDir: candidates.legacyDataDir,
        source: 'legacy-default' as const,
      };

  return {
    configDir: config.configDir != null
      ? normalizeStorageRoot(config.configDir)
      : selectedDefaultRoots.configDir,
    dataDir: config.dataDir != null
      ? normalizeStorageRoot(config.dataDir)
      : selectedDefaultRoots.dataDir,
    configSource: config.configDir != null ? 'explicit' : selectedDefaultRoots.source,
    dataSource: config.dataDir != null ? 'explicit' : selectedDefaultRoots.source,
    candidates,
    discovery,
    diagnostics: buildStorageDiagnostics(discovery),
  };
}

/**
 * Centralised path resolution for Atlas-managed storage.
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
 * ~/.config/xurgo-atlas while still discovering legacy docu-guard roots.
 */
export function getDefaultConfigDir(): string {
  return resolveStorageRoots().configDir;
}

/**
 * Default data directory follows XDG_DATA_HOME, falling back to
 * ~/.local/share/xurgo-atlas while still discovering legacy docu-guard roots.
 */
export function getDefaultDataDir(): string {
  return resolveStorageRoots().dataDir;
}
