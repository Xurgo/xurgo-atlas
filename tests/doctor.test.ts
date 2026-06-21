import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { Project } from '../src/core/project.js';
import { buildRootLedgerIdentityKey, RootLedgerStore } from '../src/core/root-ledger.js';
import { buildDoctorSnapshot, renderDoctorSnapshot } from '../src/cli/doctor.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-doctor-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function createDoctorFixture(): Promise<{
  root: string;
  configDir: string;
  dataDir: string;
  project: Project;
}> {
  const root = path.join(tmpDir, 'project');
  const configDir = path.join(tmpDir, 'config');
  const dataDir = path.join(tmpDir, 'data');
  await fs.promises.mkdir(root, { recursive: true });
  await fs.promises.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-project',
      version: '1.0.0',
      type: 'module',
      engines: {
        node: '>=22',
      },
    }, null, 2) + '\n',
    'utf-8',
  );
  await fs.promises.writeFile(
    path.join(root, '.gitignore'),
    'config/\ndata/\n',
    'utf-8',
  );

  const git = simpleGit({ baseDir: root });
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  await git.add('.');
  await git.commit('Initial source commit');
  await git.raw(['branch', '-M', 'main']);

  const project = await Project.init({
    projectRoot: root,
    projectId: 'fixture-project',
    configDir,
    dataDir,
  });

  await git.add('.');
  await git.commit('Initialize Atlas fixture');

  const canonicalRoot = await fs.promises.realpath(root);
  const identityKey = buildRootLedgerIdentityKey({
    projectId: 'fixture-project',
    canonicalProjectRoot: canonicalRoot,
    registeredProjectRoot: canonicalRoot,
    daemonProjectRoot: null,
    markerProjectId: 'fixture-project',
    markerRootPath: canonicalRoot,
    gitWorktreeRoot: canonicalRoot,
    gitCommonDir: path.join(canonicalRoot, '.git'),
  });

  const eventLog = await project.ensureEventLog();
  eventLog.storeProposal({
    project_id: 'fixture-project',
    branch: 'main',
    path: 'STATUS.md',
    base_revision: 'main',
    patch: '--- a/STATUS.md\n+++ b/STATUS.md\n@@\n-foo\n+bar\n',
    intent: 'Test proposal',
    summary: 'Seed a pending proposal for doctor coverage',
    risk_level: 'low',
    requires_approval: false,
    metadata: {
      recovery: {
        rootIdentityKey: identityKey,
        canonicalProjectRoot: canonicalRoot,
        gitWorktreeRoot: canonicalRoot,
        gitCommonDir: path.join(canonicalRoot, '.git'),
        observedAt: '2026-06-21T00:00:00.000Z',
      },
    },
  });
  eventLog.logEvent({
    project_id: 'fixture-project',
    branch: 'main',
    path: '.preview-export',
    tool_name: 'preview_export',
    summary: 'Seed preview observation',
    metadata: {
      kind: 'recovery_observation',
      operation: 'preview_export',
      rootIdentityKey: identityKey,
      canonicalProjectRoot: canonicalRoot,
      gitWorktreeRoot: canonicalRoot,
      gitCommonDir: path.join(canonicalRoot, '.git'),
      rootUnsafe: false,
      safeForWrites: true,
      rootMismatch: false,
      exportRequired: true,
      exportBlocked: false,
      warnings: [],
    },
  });

  const ledger = new RootLedgerStore(path.join(dataDir, 'projects', 'fixture-project', 'events.sqlite'));
  try {
    ledger.recordObservation({
      projectId: 'fixture-project',
      requestedCwd: root,
      projectRoot: root,
      canonicalProjectRoot: canonicalRoot,
      registeredProjectRoot: canonicalRoot,
      daemonProjectRoot: null,
      markerPath: path.join(root, '.xurgo-atlas', 'project.json'),
      markerRootPath: canonicalRoot,
      markerProjectId: 'fixture-project',
      git: {
        insideWorkTree: true,
        worktreeRoot: canonicalRoot,
        commonDir: path.join(canonicalRoot, '.git'),
        branch: 'main',
        head: await git.revparse(['HEAD']),
      },
      safety: {
        safeForWrites: true,
        ambiguous: false,
        rootMismatch: false,
        markerMismatch: false,
        markerMissing: false,
        registeredProjectRootMissing: false,
        registeredProjectRootMismatch: false,
        daemonProjectRootMismatch: false,
        gitMismatch: false,
        gitUnavailable: false,
        warnings: [],
      },
      observedAt: '2026-06-21T00:00:00.000Z',
    });
  } finally {
    ledger.close();
  }

  execFileSync(
    'sqlite3',
    [path.join(dataDir, 'projects', 'fixture-project', 'events.sqlite'), 'PRAGMA wal_checkpoint(TRUNCATE);'],
    { stdio: 'ignore' },
  );

  await fs.promises.writeFile(
    path.join(root, 'STATUS.md'),
    'local drift\n',
    'utf-8',
  );

  return { root, configDir, dataDir, project };
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function walk(current: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (relative.endsWith('-wal') || relative.endsWith('-shm')) {
          continue;
        }
        snapshot[relative] = crypto.createHash('sha256')
          .update(await fs.promises.readFile(fullPath))
          .digest('hex');
      }
    }
  }

  await walk(root);
  return snapshot;
}

describe('doctor snapshot', () => {
  it('returns a stable JSON snapshot and compact human output without mutating fixture state', async () => {
    const { root, configDir, dataDir } = await createDoctorFixture();
    const before = await Promise.all([
      snapshotFiles(root),
      snapshotFiles(configDir),
      snapshotFiles(dataDir),
    ]);

    const snapshot = await buildDoctorSnapshot({
      cwd: root,
      configDir,
      dataDir,
    });
    const rendered = renderDoctorSnapshot(snapshot);

    expect(snapshot.repo.root).toBe(await fs.promises.realpath(root));
    expect(snapshot.repo.packageName).toBe('fixture-project');
    expect(snapshot.repo.branch).toBe('main');
    expect(snapshot.repo.workingTreeClean).toBe(false);
    expect(snapshot.repo.workingTreeStatus).toBe('warn');
    expect(snapshot.project.projectId).toBe('fixture-project');
    expect(snapshot.project.severity).toBe('ok');
    expect(snapshot.managedDocs.severity).toBe('warn');
    expect(snapshot.managedDocs.exportRequired).toBe(true);
    expect(snapshot.managedDocs.outOfSyncPaths).toContain('STATUS.md');
    expect(snapshot.recovery.pendingProposalCount).toBe(1);
    expect(snapshot.recovery.lastPreviewExportObservation?.exportRequired).toBe(true);
    expect(snapshot.project.rootLedger.available).toBe(true);
    expect(snapshot.nextSteps.some((step) => step.includes('Managed docs differ from disk'))).toBe(true);

    expect(rendered).toContain('Xurgo Atlas doctor');
    expect(rendered).toContain('Managed docs [warn]');
    expect(rendered).toContain('Recovery [warn]');

    const after = await Promise.all([
      snapshotFiles(root),
      snapshotFiles(configDir),
      snapshotFiles(dataDir),
    ]);

    expect(after).toEqual(before);
  });

  it('reports missing marker as unsafe without mutating the repo or storage roots', async () => {
    const root = path.join(tmpDir, 'markerless-project');
    const configDir = path.join(tmpDir, 'config');
    const dataDir = path.join(tmpDir, 'data');

    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'markerless-project', version: '1.0.0', engines: { node: '>=22' } }, null, 2) + '\n',
      'utf-8',
    );

    const git = simpleGit({ baseDir: root });
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    await git.add('.');
    await git.commit('Initial source commit');
    await git.raw(['branch', '-M', 'main']);

    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(configDir, 'projects.json'),
      JSON.stringify({
        version: 2,
        configDir,
        dataDir,
        defaultProjectId: 'markerless-project',
        projects: {
          'markerless-project': {
            projectId: 'markerless-project',
            projectRoot: root,
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z',
          },
        },
      }, null, 2) + '\n',
      'utf-8',
    );
    await fs.promises.mkdir(dataDir, { recursive: true });

    const before = await Promise.all([
      snapshotFiles(root),
      snapshotFiles(configDir),
      snapshotFiles(dataDir),
    ]);

    const snapshot = await buildDoctorSnapshot({
      cwd: root,
      configDir,
      dataDir,
    });

    expect(snapshot.project.severity).toBe('unsafe');
    expect(snapshot.project.safety.safeForWrites).toBe(false);
    expect(snapshot.project.safety.markerMissing).toBe(true);
    expect(snapshot.project.safety.warnings).toContain('missing local project marker');

    const after = await Promise.all([
      snapshotFiles(root),
      snapshotFiles(configDir),
      snapshotFiles(dataDir),
    ]);

    expect(after).toEqual(before);
  });
});
