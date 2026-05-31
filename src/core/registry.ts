import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProjectEntry {
  projectId: string;
  projectRoot: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface RegistryData {
  version: number;
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

// ── Default paths ──────────────────────────────────────────────────────

function defaultConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, 'docu-guard');
  }
  return path.join(os.homedir(), '.config', 'docu-guard');
}

// ── Registry class ─────────────────────────────────────────────────────

export class Registry {
  private data: RegistryData;
  private configDir: string;
  private configPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? defaultConfigDir();
    this.configPath = path.join(this.configDir, 'projects.json');
    this.data = {
      version: 1,
      defaultProjectId: null,
      projects: {},
    };
  }

  // ── Load / Save ────────────────────────────────────────────────────

  /**
   * Load the registry from disk, or create a default one if the file
   * does not exist yet.
   */
  static async load(configDir?: string): Promise<Registry> {
    const registry = new Registry(configDir);
    try {
      const raw = await fs.promises.readFile(registry.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as RegistryData;
      // Basic validation
      if (parsed.version !== 1 || typeof parsed.projects !== 'object') {
        throw new Error('Invalid registry file format');
      }
      registry.data = parsed;
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
    await fs.promises.mkdir(this.configDir, { recursive: true });
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
   *   - NOT_INITIALIZED — the project root exists but has no .docu-guard/
   */
  async resolve(projectId: string): Promise<{ projectId: string; projectRoot: string }> {
    const entry = this.data.projects[projectId];
    if (!entry) {
      throw new RegistryError(
        'NOT_FOUND',
        `Project '${projectId}' not found in registry. ` +
          `Use 'docu-guard project add --project-id ${projectId} --project-root <path>' to register it.`,
      );
    }

    // Validate the project root exists
    const rootExists = await this.validateProjectRoot(entry.projectRoot);
    if (!rootExists) {
      throw new RegistryError(
        'ROOT_MISSING',
        `Project root for '${projectId}' does not exist at ${entry.projectRoot}. ` +
          `Update the path with 'docu-guard project add --project-id ${projectId} --project-root <new-path>'.`,
      );
    }

    // Validate the project has been initialized
    const initialized = await this.validateProjectInitialized(entry.projectRoot);
    if (!initialized) {
      throw new RegistryError(
        'NOT_INITIALIZED',
        `Project '${projectId}' has not been initialized. ` +
          `Run 'docu-guard init --project-root ${entry.projectRoot} --project-id ${projectId}' first.`,
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
        "'docu-guard project default --project-id <id>'.",
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
   * Check that a project root has been initialized with .docu-guard/.
   */
  private async validateProjectInitialized(projectRoot: string): Promise<boolean> {
    const docsDir = path.join(projectRoot, '.docu-guard');
    try {
      const stat = await fs.promises.stat(docsDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
