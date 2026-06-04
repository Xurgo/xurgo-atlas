import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  applyStorageMigration,
  planStorageMigration,
} from '../src/core/storage-migration.js';
import { getStorageRootCandidates } from '../src/core/storage.js';

async function withXdgRoots<T>(
  run: (roots: { root: string; configHome: string; dataHome: string }) => Promise<T>,
): Promise<T> {
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const prevDataHome = process.env.XDG_DATA_HOME;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-migrate-xdg-'));
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

async function writeRegistry(
  configDir: string,
  dataDir: string,
  projectIds: string[],
): Promise<void> {
  const projects = Object.fromEntries(projectIds.map((projectId, index) => [
    projectId,
    {
      projectId,
      projectRoot: `/tmp/${projectId}`,
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    },
  ]));

  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(configDir, 'projects.json'),
    JSON.stringify({
      version: 2,
      configDir,
      dataDir,
      defaultProjectId: null,
      projects,
    }, null, 2),
    'utf-8',
  );
}

async function writeProjectStore(
  dataDir: string,
  projectId: string,
  options: {
    includeRepo?: boolean;
    includeEvents?: boolean;
  } = {},
): Promise<void> {
  const includeRepo = options.includeRepo ?? true;
  const includeEvents = options.includeEvents ?? true;
  const projectDir = path.join(dataDir, 'projects', projectId);

  await fs.promises.mkdir(projectDir, { recursive: true });

  if (includeRepo) {
    await fs.promises.mkdir(path.join(projectDir, 'repo.git'), { recursive: true });
  }

  if (includeEvents) {
    await fs.promises.writeFile(
      path.join(projectDir, 'events.sqlite'),
      'sqlite-placeholder',
      'utf-8',
    );
  }
}

describe('storage migration planner', () => {
  it('reports when no legacy roots are found and performs no writes', async () => {
    await withXdgRoots(async () => {
      const candidates = getStorageRootCandidates();

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('no-legacy-roots-found');
      expect(plan.futureCopyActions).toContain(
        'No legacy registry or populated legacy project data were found to copy.',
      );
      await expect(fs.promises.stat(candidates.atlasConfigDir)).rejects.toThrow();
      await expect(fs.promises.stat(candidates.atlasDataDir)).rejects.toThrow();
    });
  });

  it('reports legacy-only roots and planned copy actions without creating Atlas roots', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const legacyRuntimeDir = path.join(legacyDataDir, 'runtime');
      const candidates = getStorageRootCandidates();

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-a'), {
        recursive: true,
      });
      await fs.promises.mkdir(legacyRuntimeDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(legacyRuntimeDir, 'xurgo-atlas-daemon.json'),
        '{}',
        'utf-8',
      );

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('legacy-only-roots-found');
      expect(plan.selected.configDir).toBe(legacyConfigDir);
      expect(plan.selected.dataDir).toBe(legacyDataDir);
      expect(plan.source.registry.projectCount).toBe(1);
      expect(plan.target.registry.exists).toBe(false);
      expect(plan.futureCopyActions.join('\n')).toContain(legacyConfigDir);
      expect(plan.futureCopyActions.join('\n')).toContain(path.join(legacyDataDir, 'projects'));
      expect(plan.futureSkipActions.join('\n')).toContain('Legacy source runtime artifact would be skipped');
      await expect(fs.promises.stat(candidates.atlasConfigDir)).rejects.toThrow();
      await expect(fs.promises.stat(candidates.atlasDataDir)).rejects.toThrow();
    });
  });

  it('applies a safe legacy-only copy into empty Atlas roots and leaves legacy roots untouched', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const runtimeDir = path.join(legacyDataDir, 'runtime');
      const runtimeLog = path.join(runtimeDir, 'xurgo-atlas-daemon.log');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);
      await writeProjectStore(legacyDataDir, 'legacy-a');
      await fs.promises.mkdir(runtimeDir, { recursive: true });
      await fs.promises.writeFile(runtimeLog, 'legacy log', 'utf-8');

      const result = await applyStorageMigration();
      const atlasRegistryRaw = await fs.promises.readFile(
        path.join(atlasConfigDir, 'projects.json'),
        'utf-8',
      );
      const atlasRegistry = JSON.parse(atlasRegistryRaw) as {
        configDir: string;
        dataDir: string;
        projects: Record<string, unknown>;
      };

      expect(result.copiedProjectIds).toEqual(['legacy-a']);
      expect(result.runtimeArtifactsSkipped).toContain(runtimeDir);
      expect(result.runtimeArtifactsSkipped).toContain(runtimeLog);
      expect(result.legacyRootsUntouched).toBe(true);
      expect(result.wroteAtlasTargetRoots).toBe(true);
      expect(atlasRegistry.configDir).toBe(atlasConfigDir);
      expect(atlasRegistry.dataDir).toBe(atlasDataDir);
      expect(Object.keys(atlasRegistry.projects)).toEqual(['legacy-a']);

      await expect(
        fs.promises.stat(path.join(atlasDataDir, 'projects', 'legacy-a', 'repo.git')),
      ).resolves.toBeDefined();
      await expect(
        fs.promises.stat(path.join(atlasDataDir, 'projects', 'legacy-a', 'events.sqlite')),
      ).resolves.toBeDefined();
      await expect(fs.promises.stat(path.join(legacyConfigDir, 'projects.json'))).resolves.toBeDefined();
      await expect(
        fs.promises.stat(path.join(legacyDataDir, 'projects', 'legacy-a', 'repo.git')),
      ).resolves.toBeDefined();
      await expect(fs.promises.stat(runtimeLog)).resolves.toBeDefined();
      await expect(fs.promises.stat(path.join(atlasDataDir, 'runtime'))).rejects.toThrow();
    });
  });

  it('reports both-present roots conservatively and surfaces project ID conflicts', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await writeRegistry(atlasConfigDir, atlasDataDir, ['shared', 'atlas-only']);
      await writeRegistry(legacyConfigDir, legacyDataDir, ['shared', 'legacy-only']);
      await fs.promises.mkdir(path.join(atlasDataDir, 'projects', 'atlas-only'), {
        recursive: true,
      });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-only'), {
        recursive: true,
      });

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('both-atlas-and-legacy-present');
      expect(plan.classifications).toContain('atlas-target-populated');
      expect(plan.projectIdConflicts).toEqual(['shared']);
      expect(plan.blockers.join('\n')).toContain('automatic merge');
      expect(plan.blockers.join('\n')).toContain('would conflict: shared');
    });
  });

  it('classifies partial legacy config-only state', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('partial-legacy-config-only');
      expect(plan.warnings.join('\n')).toContain('legacy data root is missing or empty');
    });
  });

  it('refuses apply when no legacy roots are found', async () => {
    await withXdgRoots(async () => {
      await expect(applyStorageMigration()).rejects.toThrow(
        'No legacy managed storage roots were found to copy into Atlas.',
      );
    });
  });

  it('refuses apply when legacy state is partial config-only', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);

      await expect(applyStorageMigration()).rejects.toThrow(
        'Legacy migration source is incomplete: the legacy registry exists, but the legacy data root is missing or empty.',
      );
    });
  });

  it('classifies partial legacy data-only state', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-a'), {
        recursive: true,
      });

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('partial-legacy-data-only');
      expect(plan.warnings.join('\n')).toContain('legacy registry file is missing');
    });
  });

  it('reports Atlas target state when Atlas roots are already populated', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');

      await writeRegistry(atlasConfigDir, atlasDataDir, ['atlas-a']);
      await fs.promises.mkdir(path.join(atlasDataDir, 'projects', 'atlas-a'), {
        recursive: true,
      });

      const plan = planStorageMigration();

      expect(plan.classifications).toContain('atlas-target-populated');
      expect(plan.classifications).not.toContain('legacy-only-roots-found');
      expect(plan.nextAction).toContain('Atlas managed storage is already in use');
    });
  });

  it('refuses apply when Atlas target roots are already populated', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);
      await writeProjectStore(legacyDataDir, 'legacy-a');
      await writeRegistry(atlasConfigDir, atlasDataDir, ['atlas-a']);
      await writeProjectStore(atlasDataDir, 'atlas-a');

      await expect(applyStorageMigration()).rejects.toThrow(
        'Atlas target roots are already populated.',
      );
    });
  });

  it('refuses apply when both Atlas and legacy roots are present with a project ID conflict', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await writeRegistry(atlasConfigDir, atlasDataDir, ['shared']);
      await writeProjectStore(atlasDataDir, 'shared');
      await writeRegistry(legacyConfigDir, legacyDataDir, ['shared']);
      await writeProjectStore(legacyDataDir, 'shared');

      await expect(applyStorageMigration()).rejects.toThrow(
        'would conflict: shared',
      );
    });
  });

  it('refuses apply while a daemon pid file is present', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const pidFile = path.join(legacyDataDir, 'runtime', 'xurgo-atlas-daemon.json');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);
      await writeProjectStore(legacyDataDir, 'legacy-a');
      await fs.promises.mkdir(path.dirname(pidFile), { recursive: true });
      await fs.promises.writeFile(pidFile, '{}', 'utf-8');

      await expect(applyStorageMigration()).rejects.toThrow(
        'A daemon PID file is present in managed storage.',
      );
    });
  });

  it('reports registry dataDir mismatches and runtime artifacts conservatively', async () => {
    await withXdgRoots(async ({ configHome, dataHome, root }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const mismatchedDataDir = path.join(root, 'somewhere-else');
      const atlasRuntimeDir = path.join(atlasDataDir, 'runtime');

      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: mismatchedDataDir,
          defaultProjectId: null,
          projects: {
            legacyA: {
              projectId: 'legacyA',
              projectRoot: '/tmp/legacyA',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacyA'), {
        recursive: true,
      });
      await fs.promises.mkdir(atlasRuntimeDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(atlasRuntimeDir, 'xurgo-atlas-daemon.log'),
        '',
        'utf-8',
      );

      const plan = planStorageMigration();

      expect(plan.source.registry.dataDirMismatch).toBe(true);
      expect(plan.blockers.join('\n')).toContain('does not match the discovered legacy data root');
      expect(plan.futureSkipActions.join('\n')).toContain('Existing Atlas runtime artifact would be left untouched');
      expect(plan.warnings.join('\n')).toContain('Atlas runtime artifacts are present');
    });
  });

  it('leaves no final Atlas registry behind when copied project validation fails', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');

      await writeRegistry(legacyConfigDir, legacyDataDir, ['legacy-a']);
      await writeProjectStore(legacyDataDir, 'legacy-a', { includeEvents: false });

      await expect(applyStorageMigration()).rejects.toThrow(
        'missing events.sqlite',
      );

      await expect(fs.promises.stat(path.join(atlasConfigDir, 'projects.json'))).rejects.toThrow();
      await expect(fs.promises.stat(atlasDataDir)).rejects.toThrow();
      await expect(fs.promises.stat(path.join(legacyConfigDir, 'projects.json'))).resolves.toBeDefined();
      await expect(
        fs.promises.stat(path.join(legacyDataDir, 'projects', 'legacy-a', 'repo.git')),
      ).resolves.toBeDefined();
    });
  });
});
