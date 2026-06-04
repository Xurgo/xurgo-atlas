import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Registry, RegistryError } from '../src/core/registry.js';
import { inspectManagedStorage } from '../src/core/storage-inspect.js';

let tmpDir: string;
let configDir: string;
let dataDir: string;

async function withXdgRoots<T>(
  run: (roots: { root: string; configHome: string; dataHome: string }) => Promise<T>,
): Promise<T> {
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const prevDataHome = process.env.XDG_DATA_HOME;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-reg-xdg-'));
  const configHome = path.join(root, 'config-home');
  const dataHome = path.join(root, 'data-home');

  process.env.XDG_CONFIG_HOME = configHome;
  process.env.XDG_DATA_HOME = dataHome;

  try {
    return await run({ root, configHome, dataHome });
  } finally {
    if (prevConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = prevConfigHome;
    }

    if (prevDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = prevDataHome;
    }

    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

function projDir(id: string): string {
  return path.join(tmpDir, id);
}

/** Create the managed data directory for a project (as init would). */
async function ensureManagedData(pid: string): Promise<void> {
  await fs.promises.mkdir(path.join(dataDir, 'projects', pid), { recursive: true });
}

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docu-guard-reg-test-'));
  configDir = path.join(tmpDir, '.config', 'docu-guard');
  dataDir = path.join(tmpDir, '.local', 'share', 'docu-guard');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('Registry CRUD', () => {
  it('should create registry with empty projects list', async () => {
    const registry = await Registry.load(configDir, dataDir);
    expect(registry.listProjects()).toEqual([]);
    expect(registry.getDefault()).toBeNull();
  });

  it('should add a project and list contains it', async () => {
    const registry = await Registry.load(configDir, dataDir);
    const entry = await registry.addProject('test-project', projDir('test'));
    expect(entry.projectId).toBe('test-project');
    expect(entry.projectRoot).toBe(projDir('test'));
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();

    const projects = registry.listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].projectId).toBe('test-project');
  });

  it('should add multiple projects and list them sorted', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('z-project', projDir('z'));
    await registry.addProject('a-project', projDir('a'));
    await registry.addProject('m-project', projDir('m'));

    const projects = registry.listProjects();
    expect(projects.length).toBe(3);
    expect(projects[0].projectId).toBe('a-project');
    expect(projects[1].projectId).toBe('m-project');
    expect(projects[2].projectId).toBe('z-project');
  });

  it('should add a project, remove it, and list is empty', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));

    const removed = await registry.removeProject('test-project');
    expect(removed).toBe(true);

    expect(registry.listProjects()).toEqual([]);
  });

  it('should return false when removing non-existent project', async () => {
    const registry = await Registry.load(configDir, dataDir);
    const removed = await registry.removeProject('nonexistent');
    expect(removed).toBe(false);
  });

  it('should show a project by id', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));

    const entry = registry.getProject('test-project');
    expect(entry).not.toBeNull();
    expect(entry!.projectRoot).toBe(projDir('test'));

    const missing = registry.getProject('nonexistent');
    expect(missing).toBeNull();
  });

  it('should update a project and preserve creation timestamp', async () => {
    const registry = await Registry.load(configDir, dataDir);
    const entry1 = await registry.addProject('test-project', projDir('original'));

    await new Promise((r) => setTimeout(r, 10));

    const entry2 = await registry.addProject('test-project', projDir('updated'));
    expect(entry2.createdAt).toBe(entry1.createdAt);
    expect(entry2.updatedAt).not.toBe(entry1.updatedAt);
    expect(entry2.projectRoot).toBe(projDir('updated'));
  });
});

describe('Registry Default', () => {
  it('should set and get default project', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.addProject('project-b', projDir('b'));

    await registry.setDefault('project-a');
    const defaultEntry = registry.getDefault();
    expect(defaultEntry).not.toBeNull();
    expect(defaultEntry!.projectId).toBe('project-a');
  });

  it('should clear default when default project is removed', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.setDefault('project-a');
    await registry.removeProject('project-a');

    expect(registry.getDefault()).toBeNull();
  });

  it('should throw when setting default for non-existent project', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await expect(registry.setDefault('nonexistent')).rejects.toThrow(RegistryError);
  });

  it('should return null for getDefault when none set', async () => {
    const registry = await Registry.load(configDir, dataDir);
    expect(registry.getDefault()).toBeNull();
  });
});

describe('Registry Resolution', () => {
  it('should resolve a valid projectId', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    // Create the managed data directory (v0.3+)
    await ensureManagedData('test-project');

    const result = await registry.resolve('test-project');
    expect(result.projectId).toBe('test-project');
    expect(result.projectRoot).toBe(projDir('test'));
  });

  it('should throw NOT_FOUND for unknown projectId', async () => {
    const registry = await Registry.load(configDir, dataDir);
    try {
      await registry.resolve('nonexistent');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe('NOT_FOUND');
      expect((err as RegistryError).message).toContain('not found in registry');
    }
  });

  it('should throw ROOT_MISSING when project root does not exist', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('nonexistent-path'));

    try {
      await registry.resolve('test-project');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe('ROOT_MISSING');
      expect((err as RegistryError).message).toContain('does not exist');
    }
  });

  it('should throw NOT_INITIALIZED when managed data dir is missing', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));
    await fs.promises.mkdir(projDir('test'), { recursive: true });
    // Don't create the managed data directory

    try {
      await registry.resolve('test-project');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe('NOT_INITIALIZED');
      expect((err as RegistryError).message).toContain('not been initialized');
    }
  });

  it('should resolve via fallback with default project', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));
    await registry.setDefault('test-project');

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    await ensureManagedData('test-project');

    const result = await registry.resolveOrFallback();
    expect(result.projectId).toBe('test-project');
  });

  it('should resolve via fallback with explicit projectId', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('test-project', projDir('test'));

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    await ensureManagedData('test-project');

    const result = await registry.resolveOrFallback('test-project');
    expect(result.projectId).toBe('test-project');
  });

  it('should throw NO_DEFAULT when no projectId and no default set', async () => {
    const registry = await Registry.load(configDir, dataDir);

    try {
      await registry.resolveOrFallback();
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe('NO_DEFAULT');
      expect((err as RegistryError).message).toContain('no default project');
    }
  });
});

describe('Registry Persistence', () => {
  it('should persist to disk and reload (v2 schema)', async () => {
    const registry1 = await Registry.load(configDir, dataDir);
    await registry1.addProject('test-project', projDir('test'));
    await registry1.setDefault('test-project');

    const registry2 = await Registry.load(configDir, dataDir);
    expect(registry2.listProjects().length).toBe(1);
    expect(registry2.listProjects()[0].projectId).toBe('test-project');
    expect(registry2.getDefault()!.projectId).toBe('test-project');
  });

  it('should produce valid JSON with v2 schema after write', async () => {
    const registry = await Registry.load(configDir, dataDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.addProject('project-b', projDir('b'));
    await registry.setDefault('project-a');

    const raw = await fs.promises.readFile(
      path.join(configDir, 'projects.json'),
      'utf-8',
    );
    expect(() => JSON.parse(raw)).not.toThrow();
    const data = JSON.parse(raw);
    expect(data.version).toBe(2);
    expect(data.configDir).toBe(configDir);
    expect(data.dataDir).toBe(dataDir);
    expect(data.defaultProjectId).toBe('project-a');
    expect(Object.keys(data.projects)).toEqual(['project-a', 'project-b']);
  });

  it('should store configDir and dataDir in v2 registry', async () => {
    const registry = await Registry.load(configDir, dataDir);
    expect(registry.configDir).toBe(configDir);
    expect(registry.dataDir).toBe(dataDir);
  });

  it('should keep saving to the selected registry file path after loading v2 metadata', async () => {
    const selectedConfigDir = path.join(tmpDir, 'selected-config');
    const driftedConfigDir = path.join(tmpDir, 'drifted-config');
    const storedDataDir = path.join(tmpDir, 'stored-data');

    await fs.promises.mkdir(selectedConfigDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(selectedConfigDir, 'projects.json'),
      JSON.stringify({
        version: 2,
        configDir: driftedConfigDir,
        dataDir: storedDataDir,
        defaultProjectId: null,
        projects: {},
      }, null, 2),
      'utf-8',
    );

    const registry = await Registry.load(selectedConfigDir);
    expect(registry.configDir).toBe(selectedConfigDir);
    expect(registry.dataDir).toBe(storedDataDir);

    await registry.addProject('test-project', projDir('test'));

    const selectedRaw = await fs.promises.readFile(
      path.join(selectedConfigDir, 'projects.json'),
      'utf-8',
    );
    const saved = JSON.parse(selectedRaw);
    expect(saved.configDir).toBe(selectedConfigDir);
    expect(saved.dataDir).toBe(storedDataDir);
    expect(saved.projects['test-project'].projectRoot).toBe(projDir('test'));

    await expect(
      fs.promises.stat(path.join(driftedConfigDir, 'projects.json')),
    ).rejects.toThrow();
  });

  it('should keep explicit dataDir overrides over stored registry metadata', async () => {
    const selectedConfigDir = path.join(tmpDir, 'selected-config');
    const storedDataDir = path.join(tmpDir, 'stored-data');
    const explicitDataDir = path.join(tmpDir, 'explicit-data');

    await fs.promises.mkdir(selectedConfigDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(selectedConfigDir, 'projects.json'),
      JSON.stringify({
        version: 2,
        configDir: selectedConfigDir,
        dataDir: storedDataDir,
        defaultProjectId: null,
        projects: {},
      }, null, 2),
      'utf-8',
    );

    const registry = await Registry.load(selectedConfigDir, explicitDataDir);
    expect(registry.configDir).toBe(selectedConfigDir);
    expect(registry.dataDir).toBe(explicitDataDir);

    await registry.addProject('test-project', projDir('test'));
    const raw = await fs.promises.readFile(
      path.join(selectedConfigDir, 'projects.json'),
      'utf-8',
    );
    const saved = JSON.parse(raw);
    expect(saved.dataDir).toBe(explicitDataDir);
  });

  it('should persist registry writes to legacy-discovered roots when only legacy storage exists', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-seed'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {},
        }, null, 2),
        'utf-8',
      );

      const registry = await Registry.load();
      expect(registry.configDir).toBe(legacyConfigDir);
      expect(registry.dataDir).toBe(legacyDataDir);

      await registry.addProject('legacy-project', projDir('legacy'));

      const saved = JSON.parse(
        await fs.promises.readFile(path.join(legacyConfigDir, 'projects.json'), 'utf-8'),
      );
      expect(saved.projects['legacy-project'].projectRoot).toBe(projDir('legacy'));

      const reloaded = await Registry.load();
      expect(reloaded.getProject('legacy-project')?.projectRoot).toBe(projDir('legacy'));
    });
  });

  it('should prefer atlas-discovered roots and leave legacy registry untouched when both installs exist', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await fs.promises.mkdir(atlasConfigDir, { recursive: true });
      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.mkdir(path.join(atlasDataDir, 'projects', 'atlas-seed'), {
        recursive: true,
      });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-seed'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(atlasConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: atlasConfigDir,
          dataDir: atlasDataDir,
          defaultProjectId: null,
          projects: {},
        }, null, 2),
        'utf-8',
      );
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {
            untouched: {
              projectId: 'untouched',
              projectRoot: projDir('untouched'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );

      const registry = await Registry.load();
      expect(registry.configDir).toBe(atlasConfigDir);
      expect(registry.dataDir).toBe(atlasDataDir);

      await registry.addProject('atlas-project', projDir('atlas'));

      const atlasSaved = JSON.parse(
        await fs.promises.readFile(path.join(atlasConfigDir, 'projects.json'), 'utf-8'),
      );
      const legacySaved = JSON.parse(
        await fs.promises.readFile(path.join(legacyConfigDir, 'projects.json'), 'utf-8'),
      );

      expect(atlasSaved.projects['atlas-project'].projectRoot).toBe(projDir('atlas'));
      expect(legacySaved.projects['atlas-project']).toBeUndefined();
      expect(legacySaved.projects.untouched.projectRoot).toBe(projDir('untouched'));
    });
  });
});

describe('Registry v1 backward compatibility', () => {
  it('should load a v1 registry and upgrade to v2 on write', async () => {
    // Write a v1-style registry file manually
    const v1data = {
      version: 1,
      defaultProjectId: 'legacy-project',
      projects: {
        'legacy-project': {
          projectId: 'legacy-project',
          projectRoot: projDir('legacy'),
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(configDir, 'projects.json'),
      JSON.stringify(v1data, null, 2),
    );

    // Load it — should succeed (upgrade in memory)
    const registry = await Registry.load(configDir, dataDir);
    expect(registry.listProjects().length).toBe(1);
    expect(registry.listProjects()[0].projectId).toBe('legacy-project');
    expect(registry.getDefault()!.projectId).toBe('legacy-project');
    expect(registry.configDir).toBe(configDir);
    expect(registry.dataDir).toBe(dataDir);

    // Trigger a write (e.g. by adding a project) and verify v2 format
    await registry.addProject('new-project', projDir('new'));
    const raw = await fs.promises.readFile(
      path.join(configDir, 'projects.json'),
      'utf-8',
    );
    const saved = JSON.parse(raw);
    expect(saved.version).toBe(2);
    expect(saved.configDir).toBe(configDir);
    expect(saved.dataDir).toBe(dataDir);
    expect(saved.defaultProjectId).toBe('legacy-project');
    expect(Object.keys(saved.projects)).toEqual(['legacy-project', 'new-project']);
  });
});

describe('Storage inspection helpers', () => {
  it('inspects atlas-vs-legacy storage state without modifying files', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const atlasRuntimeDir = path.join(atlasDataDir, 'runtime');

      await fs.promises.mkdir(path.join(atlasDataDir, 'projects', 'atlas-project'), {
        recursive: true,
      });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-project'), {
        recursive: true,
      });
      await fs.promises.mkdir(atlasRuntimeDir, { recursive: true });
      await fs.promises.mkdir(atlasConfigDir, { recursive: true });
      await fs.promises.mkdir(legacyConfigDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(atlasConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: atlasConfigDir,
          dataDir: atlasDataDir,
          defaultProjectId: null,
          projects: {
            atlasA: {
              projectId: 'atlasA',
              projectRoot: projDir('atlasA'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            atlasB: {
              projectId: 'atlasB',
              projectRoot: projDir('atlasB'),
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {
            legacyOnly: {
              projectId: 'legacyOnly',
              projectRoot: projDir('legacyOnly'),
              createdAt: '2026-01-03T00:00:00.000Z',
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );
      await fs.promises.writeFile(
        path.join(atlasRuntimeDir, 'xurgo-atlas-daemon.json'),
        '{}',
        'utf-8',
      );

      const report = inspectManagedStorage();

      expect(report.selected.configDir).toBe(atlasConfigDir);
      expect(report.selected.dataDir).toBe(atlasDataDir);
      expect(report.selected.sourceSummary).toBe('atlas-default');
      expect(report.selected.registry.exists).toBe(true);
      expect(report.selected.registry.projectCount).toBe(2);
      expect(report.selected.runtime.runtimeDirExists).toBe(true);
      expect(report.selected.runtime.pidFileExists).toBe(true);
      expect(report.selected.runtime.logFileExists).toBe(false);
      expect(report.atlas.present).toBe(true);
      expect(report.atlas.registry.projectCount).toBe(2);
      expect(report.legacy.present).toBe(true);
      expect(report.legacy.registry.projectCount).toBe(1);
      expect(report.bothPresent).toBe(true);
      expect(report.diagnostics).toHaveLength(1);
    });
  });

  it('reports unreadable registry counts without writing or throwing', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');

      await fs.promises.mkdir(atlasConfigDir, { recursive: true });
      await fs.promises.mkdir(path.join(atlasDataDir, 'projects', 'atlas-project'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(atlasConfigDir, 'projects.json'),
        '{not-json',
        'utf-8',
      );

      const report = inspectManagedStorage();

      expect(report.selected.registry.exists).toBe(true);
      expect(report.selected.registry.projectCount).toBeNull();
      expect(report.selected.registry.readError).toBeTruthy();
      expect(report.atlas.registry.projectCount).toBeNull();
      expect(report.atlas.registry.readError).toBeTruthy();
    });
  });
});
