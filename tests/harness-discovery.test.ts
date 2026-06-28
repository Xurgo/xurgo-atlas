import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HARNESS_DISCOVERY_CATALOG,
  buildSafeDirectoryPresenceChecker,
  createInvalidProjectRootError,
  snapshotHarnessDiscovery,
} from '../src/core/harness-discovery.js';
import { ProjectResolutionError } from '../src/core/project-resolution.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-harness-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('snapshotHarnessDiscovery', () => {
  it('reports exact known marker and root presence as descriptors', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'AGENTS.md'), '# agent guidance\n', 'utf-8');
    await fs.promises.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.promises.mkdir(path.join(tmpDir, '.cursor'), { recursive: true });

    const snapshot = await snapshotHarnessDiscovery(
      tmpDir,
      buildSafeDirectoryPresenceChecker({
        async assertProjectRootDirectory(projectRoot) {
          const stat = await fs.promises.lstat(projectRoot);
          if (!stat.isDirectory()) {
            throw createInvalidProjectRootError(projectRoot);
          }
        },
        async pathExists(absolutePath) {
          try {
            await fs.promises.lstat(absolutePath);
            return true;
          } catch {
            return false;
          }
        },
      }),
    );
    const byPath = new Map(
      snapshot.descriptors.map((descriptor) => [descriptor.projectRelativePath, descriptor]),
    );

    expect(byPath.get('AGENTS.md')).toMatchObject({
      adapterId: 'atlas.interop.agents-md',
      artifactClass: 'instruction_only',
      capabilityTier: 'discover_only',
      present: true,
      discoveryStatus: 'present',
      toolNativeRootId: 'agents_md_interoperability',
    });
    expect(byPath.get('.claude')).toMatchObject({
      adapterId: 'anthropic.claude-code',
      artifactClass: 'tool_native_root_namespace',
      capabilityTier: 'deferred_or_unsafe',
      present: true,
      discoveryStatus: 'present',
      toolNativeRootId: 'claude_code_root',
    });
    expect(byPath.get('.cursor')).toMatchObject({
      adapterId: 'cursor.cursor',
      artifactClass: 'tool_native_root_namespace',
      capabilityTier: 'deferred_or_unsafe',
      present: true,
      discoveryStatus: 'present',
      toolNativeRootId: 'cursor_root',
    });
  });

  it('reports absent markers safely and checks only cataloged paths', async () => {
    const checkedPaths: string[] = [];
    const present = new Set([
      path.join('/virtual/project', 'AGENTS.md'),
      path.join('/virtual/project', '.kiro'),
    ]);

    const snapshot = await snapshotHarnessDiscovery(
      '/virtual/project',
      buildSafeDirectoryPresenceChecker({
        async assertProjectRootDirectory(projectRoot) {
          expect(projectRoot).toBe(path.resolve('/virtual/project'));
        },
        async pathExists(filePath) {
          checkedPaths.push(filePath);
          return present.has(filePath);
        },
      }),
    );

    expect(checkedPaths).toEqual(
      HARNESS_DISCOVERY_CATALOG.map((entry) =>
        path.join(path.resolve('/virtual/project'), entry.projectRelativePath),
      ),
    );
    const agents = snapshot.descriptors.find((descriptor) => descriptor.projectRelativePath === 'AGENTS.md');
    const kiro = snapshot.descriptors.find((descriptor) => descriptor.projectRelativePath === '.kiro');
    const claude = snapshot.descriptors.find((descriptor) => descriptor.projectRelativePath === '.claude');

    expect(agents?.present).toBe(true);
    expect(agents?.discoveryStatus).toBe('present');
    expect(kiro?.present).toBe(true);
    expect(kiro?.discoveryStatus).toBe('present');
    expect(claude?.present).toBe(false);
    expect(claude?.discoveryStatus).toBe('absent');
  });

  it('uses only exact cataloged presence checks through the constrained seam', async () => {
    const operations = {
      assertProjectRootDirectory: vi.fn(async (_projectRoot: string) => undefined),
      pathExists: vi.fn(async (_absolutePath: string) => false),
    };

    const checker = buildSafeDirectoryPresenceChecker(operations);
    const snapshot = await snapshotHarnessDiscovery(tmpDir, checker);

    expect(snapshot.descriptors).toHaveLength(HARNESS_DISCOVERY_CATALOG.length);
    expect(operations.assertProjectRootDirectory).toHaveBeenCalledTimes(1);
    expect(operations.pathExists).toHaveBeenCalledTimes(HARNESS_DISCOVERY_CATALOG.length);
    expect(operations.pathExists.mock.calls).toEqual(
      HARNESS_DISCOVERY_CATALOG.map((entry) => [
        path.join(path.resolve(tmpDir), entry.projectRelativePath),
      ]),
    );
  });

  it('does not read content, enumerate child files, parse, hash, or invoke network access when backed by lstat-only operations', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'AGENTS.md'), 'secret\n', 'utf-8');
    await fs.promises.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, '.claude', 'settings.json'), '{"apiKey":"secret"}\n', 'utf-8');

    const readFileSpy = vi.spyOn(fs.promises, 'readFile');
    const readdirSpy = vi.spyOn(fs.promises, 'readdir');
    const lstatSpy = vi.spyOn(fs.promises, 'lstat');
    const parseSpy = vi.spyOn(JSON, 'parse');
    const hashSpy = vi.spyOn(crypto.subtle, 'digest');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const snapshot = await snapshotHarnessDiscovery(
      tmpDir,
      buildSafeDirectoryPresenceChecker({
        async assertProjectRootDirectory(projectRoot) {
          const stat = await fs.promises.lstat(projectRoot);
          if (!stat.isDirectory()) {
            throw createInvalidProjectRootError(projectRoot);
          }
        },
        async pathExists(absolutePath) {
          try {
            await fs.promises.lstat(absolutePath);
            return true;
          } catch {
            return false;
          }
        },
      }),
    );

    expect(snapshot.descriptors).toHaveLength(HARNESS_DISCOVERY_CATALOG.length);
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lstatSpy).toHaveBeenCalled();
  });

  it('rejects unsafe root inputs consistently with project-resolution errors', async () => {
    const filePath = path.join(tmpDir, 'not-a-directory.txt');
    await fs.promises.writeFile(filePath, 'x', 'utf-8');

    const checker = buildSafeDirectoryPresenceChecker({
      async assertProjectRootDirectory(projectRoot) {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.lstat(projectRoot);
        } catch {
          throw createInvalidProjectRootError(projectRoot);
        }
        if (!stat.isDirectory()) {
          throw createInvalidProjectRootError(projectRoot);
        }
      },
      async pathExists(absolutePath) {
        await fs.promises.lstat(absolutePath);
        return true;
      },
    });

    await expect(snapshotHarnessDiscovery(filePath, checker)).rejects.toMatchObject({
      name: ProjectResolutionError.name,
      message: `Project root "${path.resolve(filePath)}" does not exist or is not a directory.`,
    });

    await expect(snapshotHarnessDiscovery(path.join(tmpDir, 'missing-root'), checker)).rejects.toMatchObject({
      name: ProjectResolutionError.name,
      message: `Project root "${path.resolve(tmpDir, 'missing-root')}" does not exist or is not a directory.`,
    });
  });
});
