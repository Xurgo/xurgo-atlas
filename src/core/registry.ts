import * as fs from 'node:fs';
import * as path from 'node:path';
import { expandTilde, getDefaultConfigDir, getDefaultDataDir } from './storage.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProjectEntry {
  projectId: string;
  projectRoot: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface RegistryData {
  version: number;
  configDir: string;
  dataDir: string;
  defaultProjectId: string | null;
  projects: Record<string, ProjectEntry>;
}

export type RegistryErrorCode =
  | 'NOT_FOUND'
  | 'ROOT_MISSING'
  | 'NOT_INITIALIZED'
  | 'NO_DEFAULT';

export class RegistryError extends Error {
  code: RegistryErrorCode;

  constructor(code: RegistryErrorCode, message: string) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
  }
}

// ── Registry class ─────────────────────────────────────────────────────

export class Registry {
  private data: RegistryData;
  private _configDir: string;
  private _dataDir: string;
  private configPath: string;

  constructor(configDir?: string, dataDir?: string) {
    this._configDir = configDir != null
      ? path.resolve(expandTilde(configDir))
      : getDefaultConfigDir();
    this._dataDir = dataDir != null
      ? path.resolve(expandTilde(dataDir))
      : getDefaultDataDir();
    this.configPath = path.join(this._configDir, 'projects.json');
    this.data = {
      version: 2,
      configDir: this._configDir,
      dataDir: this._dataDir,
      defaultProjectId: null,
      projects: {},
    };
  }

  /** The config directory used by this registry instance. */
  get configDir(): string {
    return this._configDir;
  }

  /** The data directory used by this registry instance. */
  get dataDir(): string {
    return this._dataDir;
  }

  // ── Load / Save ────────────────────────────────────────────────────

  /**
   * Load the registry from disk, or create a default one if the file
   * does not exist yet.
   *
   * Backward-compatible with v1 schema: v1 files are upgraded to v2
   * in memory and saved as v2 on the next write.
   */
  static async load(configDir?: string, dataDir?: string): Promise<Registry> {
    const registry = new Registry(configDir, dataDir);
    try {
      const raw = await fs.promises.readFile(registry.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (parsed.version === 2) {
        // v2 schema — use directly
        registry.data = parsed as unknown as RegistryData;
        // Use the stored paths for this session
        registry._configDir = registry.data.configDir;
        registry._dataDir = registry.data.dataDir;
      } else if (parsed.version === 1 || !parsed.version) {
        // v1 schema — upgrade in memory to v2
        const v1data = parsed as {
          version?: number;
          defaultProjectId?: string | null;
          projects?: Record<string, ProjectEntry>;
        };
        registry.data = {
          version: 2,
          configDir: registry._configDir,
          dataDir: registry._dataDir,
          defaultProjectId: v1data.defaultProjectId ?? null,
          projects: v1data.projects ?? {},
        };
      } else {
        throw new Error(`Unsupported registry schema version: ${parsed.version}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet — start with default data
        return registry;
      }
      // Re-throw unexpected errors
      throw err;
    }
    return registry;
  }

  /**
   * Persist the registry to disk atomically (write to temp file, then rename).
   */
  private async save(): Promise<void> {
    await fs.promises.mkdir(this._configDir, { recursive: true });
    const tmpPath = this.configPath + '.tmp';
    const raw = JSON.stringify(this.data, null, 2) + '\n';
    await fs.promises.writeFile(tmpPath, raw, 'utf-8');
    await fs.promises.rename(tmpPath, this.configPath);
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  /**
   * Add or update a project entry.
   */
  async addProject(projectId: string, projectRoot: string): Promise<ProjectEntry> {
    const now = new Date().toISOString();
    const existing = this.data.projects[projectId];
    const entry: ProjectEntry = {
      projectId,
      projectRoot,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.data.projects[projectId] = entry;
    await this.save();
    return entry;
  }

  /**
   * Remove a project entry. Returns true if the project existed, false otherwise.
   * Does not delete the project data on disk.
   */
  async removeProject(projectId: string): Promise<boolean> {
    if (!this.data.projects[projectId]) {
      return false;
    }
    delete this.data.projects[projectId];
    // Clear default if it was the removed project
    if (this.data.defaultProjectId === projectId) {
      this.data.defaultProjectId = null;
    }
    await this.save();
    return true;
  }

  /**
   * Return all registered project entries, sorted by projectId.
   */
  listProjects(): ProjectEntry[] {
    return Object.values(this.data.projects).sort((a, b) =>
      a.projectId.localeCompare(b.projectId),
    );
  }

  /**
   * Get a single project entry, or null if not found.
   */
  getProject(projectId: string): ProjectEntry | null {
    return this.data.projects[projectId] ?? null;
  }

  /**
   * Set the default project. Throws if the project is not in the registry.
   */
  async setDefault(projectId: string): Promise<void> {
    if (!this.data.projects[projectId]) {
      throw new RegistryError(
        'NOT_FOUND',
        `Project "${projectId}" not found in registry.`,
      );
    }
    this.data.defaultProjectId = projectId;
    await this.save();
  }

  /**
   * Get the default project entry, or null if none is set.
   */
  getDefault(): ProjectEntry | null {
    if (!this.data.defaultProjectId) {
      return null;
    }
    return this.data.projects[this.data.defaultProjectId] ?? null;
  }

  // ── Resolution ─────────────────────────────────────────────────────

  /**
   * Resolve a projectId to { projectId, projectRoot } with full validation.
   *
   * Throws RegistryError with detailed, actionable messages for every
   * failure mode:
   *   - NOT_FOUND       — projectId is not in the registry
   *   - ROOT_MISSING    — the registered project root does not exist on disk
   *   - NOT_INITIALIZED — the project's managed data store has not been created
   */
  async resolve(projectId: string): Promise<{ projectId: string; projectRoot: string }> {
    const entry = this.data.projects[projectId];
    if (!entry) {
      throw new RegistryError(
        'NOT_FOUND',
        `Project '${projectId}' not found in registry. ` +
          `Use 'xurgo-atlas project add --project-id ${projectId} --project-root <path>' to register it ` +
          `(legacy alias: 'docu-guard project add --project-id ${projectId} --project-root <path>').`,
      );
    }

    // Validate the project root exists
    const rootExists = await this.validateProjectRoot(entry.projectRoot);
    if (!rootExists) {
      throw new RegistryError(
        'ROOT_MISSING',
        `Project root for '${projectId}' does not exist at ${entry.projectRoot}. ` +
          `Update the path with 'xurgo-atlas project add --project-id ${projectId} --project-root <new-path>' ` +
          `(legacy alias: 'docu-guard project add --project-id ${projectId} --project-root <new-path>').`,
      );
    }

    // Validate the project has been initialized (managed data store exists)
    const initialized = await this.validateProjectInitialized(projectId);
    if (!initialized) {
      throw new RegistryError(
        'NOT_INITIALIZED',
        `Project '${projectId}' has not been initialized. ` +
          `Run 'xurgo-atlas init --project-root ${entry.projectRoot} --project-id ${projectId}' first ` +
          `(legacy alias: 'docu-guard init --project-root ${entry.projectRoot} --project-id ${projectId}').`,
      );
    }

    return { projectId: entry.projectId, projectRoot: entry.projectRoot };
  }

  /**
   * Resolve an optional projectId, falling back to the default project.
   *
   * - If projectId is provided (non-empty), delegate to resolve().
   * - If projectId is empty and a default exists, resolve the default.
   * - If projectId is empty and no default exists, throw NO_DEFAULT.
   */
  async resolveOrFallback(projectId?: string): Promise<{ projectId: string; projectRoot: string }> {
    if (projectId && projectId.trim().length > 0) {
      return this.resolve(projectId.trim());
    }

    // Try the default
    if (this.data.defaultProjectId) {
      return this.resolve(this.data.defaultProjectId);
    }

    throw new RegistryError(
      'NO_DEFAULT',
      'No projectId provided and no default project is set. ' +
        'Provide --project-id or set a default with ' +
        "'xurgo-atlas project default --project-id <id>' " +
        "(legacy alias: 'docu-guard project default --project-id <id>').",
    );
  }

  // ── Validation helpers ─────────────────────────────────────────────

  /**
   * Check that a registered project root exists on disk.
   */
  private async validateProjectRoot(projectRoot: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(projectRoot);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check that a project has been initialized by verifying the managed
   * data directory exists (v0.3+).
   *
   * For pre-v0.3 projects that only have a .docu-guard/ directory,
   * this check fails — the user must migrate.
   */
  private async validateProjectInitialized(projectId: string): Promise<boolean> {
    const dataDir = path.join(this._dataDir, 'projects', projectId);
    try {
      const stat = await fs.promises.stat(dataDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
