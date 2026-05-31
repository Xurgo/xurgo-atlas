import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Registry, RegistryError } from '../src/core/registry.js';

let tmpDir: string;
let configDir: string;

function projDir(id: string): string {
  return path.join(tmpDir, id);
}

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docu-guard-reg-test-'));
  configDir = path.join(tmpDir, '.config', 'docu-guard');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('Registry CRUD', () => {
  it('should create registry with empty projects list', async () => {
    const registry = await Registry.load(configDir);
    expect(registry.listProjects()).toEqual([]);
    expect(registry.getDefault()).toBeNull();
  });

  it('should add a project and list contains it', async () => {
    const registry = await Registry.load(configDir);
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
    const registry = await Registry.load(configDir);
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
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));

    const removed = await registry.removeProject('test-project');
    expect(removed).toBe(true);

    expect(registry.listProjects()).toEqual([]);
  });

  it('should return false when removing non-existent project', async () => {
    const registry = await Registry.load(configDir);
    const removed = await registry.removeProject('nonexistent');
    expect(removed).toBe(false);
  });

  it('should show a project by id', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));

    const entry = registry.getProject('test-project');
    expect(entry).not.toBeNull();
    expect(entry!.projectRoot).toBe(projDir('test'));

    const missing = registry.getProject('nonexistent');
    expect(missing).toBeNull();
  });

  it('should update a project and preserve creation timestamp', async () => {
    const registry = await Registry.load(configDir);
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
    const registry = await Registry.load(configDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.addProject('project-b', projDir('b'));

    await registry.setDefault('project-a');
    const defaultEntry = registry.getDefault();
    expect(defaultEntry).not.toBeNull();
    expect(defaultEntry!.projectId).toBe('project-a');
  });

  it('should clear default when default project is removed', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.setDefault('project-a');
    await registry.removeProject('project-a');

    expect(registry.getDefault()).toBeNull();
  });

  it('should throw when setting default for non-existent project', async () => {
    const registry = await Registry.load(configDir);
    await expect(registry.setDefault('nonexistent')).rejects.toThrow(RegistryError);
  });

  it('should return null for getDefault when none set', async () => {
    const registry = await Registry.load(configDir);
    expect(registry.getDefault()).toBeNull();
  });
});

describe('Registry Resolution', () => {
  it('should resolve a valid projectId', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    await fs.promises.mkdir(path.join(projDir('test'), '.docu-guard'), { recursive: true });

    const result = await registry.resolve('test-project');
    expect(result.projectId).toBe('test-project');
    expect(result.projectRoot).toBe(projDir('test'));
  });

  it('should throw NOT_FOUND for unknown projectId', async () => {
    const registry = await Registry.load(configDir);
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
    const registry = await Registry.load(configDir);
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

  it('should throw NOT_INITIALIZED when .docu-guard is missing', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));
    await fs.promises.mkdir(projDir('test'), { recursive: true });
    // Don't create .docu-guard

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
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));
    await registry.setDefault('test-project');

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    await fs.promises.mkdir(path.join(projDir('test'), '.docu-guard'), { recursive: true });

    const result = await registry.resolveOrFallback();
    expect(result.projectId).toBe('test-project');
  });

  it('should resolve via fallback with explicit projectId', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('test-project', projDir('test'));

    await fs.promises.mkdir(projDir('test'), { recursive: true });
    await fs.promises.mkdir(path.join(projDir('test'), '.docu-guard'), { recursive: true });

    const result = await registry.resolveOrFallback('test-project');
    expect(result.projectId).toBe('test-project');
  });

  it('should throw NO_DEFAULT when no projectId and no default set', async () => {
    const registry = await Registry.load(configDir);

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
  it('should persist to disk and reload', async () => {
    const registry1 = await Registry.load(configDir);
    await registry1.addProject('test-project', projDir('test'));
    await registry1.setDefault('test-project');

    const registry2 = await Registry.load(configDir);
    expect(registry2.listProjects().length).toBe(1);
    expect(registry2.listProjects()[0].projectId).toBe('test-project');
    expect(registry2.getDefault()!.projectId).toBe('test-project');
  });

  it('should produce valid JSON after every write', async () => {
    const registry = await Registry.load(configDir);
    await registry.addProject('project-a', projDir('a'));
    await registry.addProject('project-b', projDir('b'));
    await registry.setDefault('project-a');

    const raw = await fs.promises.readFile(
      path.join(configDir, 'projects.json'),
      'utf-8',
    );
    expect(() => JSON.parse(raw)).not.toThrow();
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.defaultProjectId).toBe('project-a');
    expect(Object.keys(data.projects)).toEqual(['project-a', 'project-b']);
  });
});
