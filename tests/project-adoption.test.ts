import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { Project } from '../src/core/project.js';
import { adoptProject } from '../src/core/project-adoption.js';
import { buildDoctorSnapshot } from '../src/cli/doctor.js';
import { getMcpConfigOutput } from '../src/cli/mcp-config.js';

let tmpDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpDir) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

async function createRepoFixture(): Promise<{
  root: string;
  configDir: string;
  dataDir: string;
  git: ReturnType<typeof simpleGit>;
}> {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-adopt-'));
  const root = path.join(tmpDir, 'repo');
  const configDir = path.join(tmpDir, 'config');
  const dataDir = path.join(tmpDir, 'data');

  await fs.promises.mkdir(root, { recursive: true });
  await fs.promises.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'adoption-fixture',
      version: '1.0.0',
      engines: { node: '>=22' },
    }, null, 2) + '\n',
    'utf-8',
  );
  await fs.promises.writeFile(
    path.join(root, '.gitignore'),
    '.xurgo-atlas/\n',
    'utf-8',
  );

  const git = simpleGit({ baseDir: root });
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  await git.add('.');
  await git.commit('Initial commit');
  await git.raw(['branch', '-M', 'main']);

  return { root, configDir, dataDir, git };
}

async function readRegistry(configDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.promises.readFile(path.join(configDir, 'projects.json'), 'utf-8')) as Record<string, unknown>;
}

function realPath(value: string): string {
  return fs.realpathSync.native(value);
}

async function writeMarker(root: string, projectId: string): Promise<void> {
  const markerPath = path.join(root, '.xurgo-atlas', 'project.json');
  await fs.promises.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.promises.writeFile(
    markerPath,
    JSON.stringify({ schemaVersion: 1, projectId }, null, 2) + '\n',
    'utf-8',
  );
}

describe('project adoption', () => {
  it('adopts a clean clone with explicit identity and leaves the repository clean', async () => {
    const { root, configDir, dataDir, git } = await createRepoFixture();

    const result = await adoptProject({
      projectRoot: root,
      projectId: 'adoption-fixture',
      configDir,
      dataDir,
    });

    expect(result.created).toBe(true);
    expect(result.alreadyAdopted).toBe(false);
    expect(result.projectId).toBe('adoption-fixture');
    expect(result.projectRoot).toBe(realPath(root));
    expect(await readRegistry(configDir)).toMatchObject({
      projects: {
        'adoption-fixture': {
          projectId: 'adoption-fixture',
          projectRoot: realPath(root),
        },
      },
    });
    expect(fs.existsSync(path.join(dataDir, 'projects', 'adoption-fixture'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.xurgo-atlas'))).toBe(false);
    expect((await git.status()).files).toHaveLength(0);
  });

  it('adopts a legacy marker without hydrating a managed store', async () => {
    const { root, configDir, dataDir, git } = await createRepoFixture();
    await writeMarker(root, 'legacy-adoption');

    const first = await adoptProject({
      projectRoot: root,
      configDir,
      dataDir,
    });
    const second = await adoptProject({
      projectRoot: root,
      configDir,
      dataDir,
    });

    expect(first.created).toBe(true);
    expect(first.projectId).toBe('legacy-adoption');
    expect(second.alreadyAdopted).toBe(true);
    expect(await readRegistry(configDir)).toMatchObject({
      projects: {
        'legacy-adoption': {
          projectId: 'legacy-adoption',
          projectRoot: realPath(root),
        },
      },
    });
    expect(fs.existsSync(path.join(dataDir, 'projects', 'legacy-adoption'))).toBe(false);
    expect(await fs.promises.readFile(path.join(root, '.xurgo-atlas', 'project.json'), 'utf-8')).toContain('"legacy-adoption"');
    expect((await git.status()).files).toHaveLength(0);
  });

  it('rejects a conflicting marker and explicit identity pair', async () => {
    const { root, configDir, dataDir } = await createRepoFixture();
    await writeMarker(root, 'alpha');

    await expect(
      adoptProject({
        projectRoot: root,
        projectId: 'beta',
        configDir,
        dataDir,
      }),
    ).rejects.toThrow(/Local project marker/);

    expect(fs.existsSync(path.join(configDir, 'projects.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'projects'))).toBe(false);
  });

  it('is idempotent for the same canonical root', async () => {
    const { root, configDir, dataDir } = await createRepoFixture();

    const first = await adoptProject({
      projectRoot: root,
      projectId: 'alpha',
      configDir,
      dataDir,
    });
    const registryAfterFirst = await readRegistry(configDir);
    const second = await adoptProject({
      projectRoot: root,
      projectId: 'alpha',
      configDir,
      dataDir,
    });
    const registryAfterSecond = await readRegistry(configDir);

    expect(first.created).toBe(true);
    expect(second.alreadyAdopted).toBe(true);
    expect(registryAfterSecond).toEqual(registryAfterFirst);
    expect(fs.existsSync(path.join(dataDir, 'projects', 'alpha'))).toBe(false);
  });

  it.each([
    ['second clone', 'same project id on a second checkout'],
    ['fork/rekey', 'same legacy marker on a forked checkout'],
  ])('rejects registry collisions for %s', async (_label, scenario) => {
    const source = await createRepoFixture();
    await adoptProject({
      projectRoot: source.root,
      projectId: 'collision-project',
      configDir: source.configDir,
      dataDir: source.dataDir,
    });

    const otherRoot = path.join(tmpDir, `${scenario.replace(/\s+/g, '-')}`);
    const cloneGit = simpleGit({ baseDir: tmpDir });
    await cloneGit.clone(source.root, otherRoot);

    if (scenario.includes('fork')) {
      await writeMarker(otherRoot, 'collision-project');
    }

    await expect(
      adoptProject({
        projectRoot: otherRoot,
        projectId: scenario.includes('fork') ? undefined : 'collision-project',
        configDir: source.configDir,
        dataDir: source.dataDir,
      }),
    ).rejects.toThrow(/Adoption will not rebind|will not overwrite/);
  });

  it('accepts symlinked and worktree checkouts through canonical root validation', async () => {
    const { root, configDir, dataDir } = await createRepoFixture();
    const symlinkRoot = path.join(tmpDir, 'repo-link');
    await fs.promises.symlink(root, symlinkRoot, 'dir');

    const worktreeRoot = path.join(tmpDir, 'repo-worktree');
    await simpleGit({ baseDir: root }).raw(['worktree', 'add', worktreeRoot, '-b', 'worktree-adoption']);

    const symlinkResult = await adoptProject({
      projectRoot: symlinkRoot,
      projectId: 'symlink-project',
      configDir,
      dataDir,
    });
    const worktreeResult = await adoptProject({
      projectRoot: worktreeRoot,
      projectId: 'worktree-project',
      configDir,
      dataDir,
    });

    expect(symlinkResult.projectRoot).toBe(realPath(root));
    expect(worktreeResult.projectRoot).toBe(realPath(worktreeRoot));
    expect(fs.existsSync(path.join(dataDir, 'projects', 'symlink-project'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'projects', 'worktree-project'))).toBe(false);
  });

  it('preserves proposals on an already initialized project', async () => {
    const { root, configDir, dataDir, git } = await createRepoFixture();
    const project = await Project.init({
      projectRoot: root,
      projectId: 'alpha',
      configDir,
      dataDir,
    });

    await git.add('.');
    await git.commit('Initialize Atlas fixture');

    project.eventLog.storeProposal({
      project_id: 'alpha',
      branch: 'main',
      path: 'STATUS.md',
      base_revision: 'main',
      patch: '--- a/STATUS.md\n+++ b/STATUS.md\n@@\n-old\n+new\n',
      intent: 'Keep proposal for preservation test',
      summary: 'Seed a pending proposal',
      risk_level: 'low',
      requires_approval: false,
    });

    const pendingBefore = project.eventLog.listProposals({
      projectId: 'alpha',
      status: 'pending',
    });

    const result = await adoptProject({
      projectRoot: root,
      projectId: 'alpha',
      configDir,
      dataDir,
    });

    const pendingAfter = project.eventLog.listProposals({
      projectId: 'alpha',
      status: 'pending',
    });

    expect(result.alreadyAdopted).toBe(true);
    expect(pendingAfter).toHaveLength(pendingBefore.length);
    expect((await git.status()).files).toHaveLength(0);
  });

  it('reports the adopted-but-unhydrated doctor model and keeps mcp-config compatibility', async () => {
    const { root, configDir, dataDir, git } = await createRepoFixture();
    await adoptProject({
      projectRoot: root,
      projectId: 'alpha',
      configDir,
      dataDir,
    });

    const snapshot = await buildDoctorSnapshot({
      cwd: root,
      configDir,
      dataDir,
    });

    expect(snapshot.project.projectId).toBe('alpha');
    expect(snapshot.project.identity.identityKnown).toBe(true);
    expect(snapshot.project.identity.identityRegistered).toBe(true);
    expect(snapshot.project.identity.managedStoreAvailable).toBe(false);
    expect(snapshot.project.identity.governanceActivated).toBe(false);
    expect(snapshot.project.identity.readOnlyDiscoveryEligible).toBe(true);
    expect(snapshot.project.identity.managedWriteEligible).toBe(false);
    expect(snapshot.project.identity.daemonBound).toBe(false);

    const mcpConfig = JSON.parse(
      await getMcpConfigOutput({
        json: true,
        cwd: root,
        configDir,
        dataDir,
      }),
    ) as { projectId: string | null; projectRoot: string | null };

    expect(mcpConfig.projectId).toBeNull();
    expect(mcpConfig.projectRoot).toBeNull();
    expect((await git.status()).files).toHaveLength(0);
  });
});
