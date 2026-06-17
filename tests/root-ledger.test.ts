import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  RootLedgerStore,
  type RootLedgerObservation,
} from '../src/core/root-ledger.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-root-ledger-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function createObservation(
  overrides: Partial<RootLedgerObservation> = {},
): RootLedgerObservation {
  return {
    projectId: 'atlas-test',
    requestedCwd: '/workspace/project',
    projectRoot: '/workspace/project',
    canonicalProjectRoot: '/workspace/project',
    registeredProjectRoot: '/workspace/project',
    daemonProjectRoot: null,
    markerPath: '/workspace/project/.xurgo-atlas/project.json',
    markerRootPath: '/workspace/project',
    markerProjectId: 'atlas-test',
    git: {
      insideWorkTree: true,
      worktreeRoot: '/workspace/project',
      commonDir: '/workspace/project/.git',
      branch: 'main',
      head: '0123456789abcdef0123456789abcdef01234567',
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
    ...overrides,
  };
}

describe('RootLedgerStore', () => {
  it('creates the root_worktree_ledger schema on first use', () => {
    const dbPath = path.join(tmpDir, 'events.sqlite');
    const store = new RootLedgerStore(dbPath);

    try {
      store.recordObservation(createObservation());
    } finally {
      store.close();
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const table = db.prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'root_worktree_ledger'
        `,
      ).get() as { name: string } | undefined;

      expect(table?.name).toBe('root_worktree_ledger');
    } finally {
      db.close();
    }
  });

  it('records a first observation and updates last-seen state on repeats', () => {
    const dbPath = path.join(tmpDir, 'events.sqlite');
    const store = new RootLedgerStore(dbPath);

    try {
      const first = store.recordObservation(
        createObservation({
          requestedCwd: '/workspace/project',
          observedAt: '2026-06-17T10:00:00.000Z',
        }),
      );
      const second = store.recordObservation(
        createObservation({
          requestedCwd: '/workspace/project/nested',
          git: {
            insideWorkTree: true,
            worktreeRoot: '/workspace/project',
            commonDir: '/workspace/project/.git',
            branch: 'feature/root-ledger',
            head: '89abcdef0123456789abcdef0123456789abcdef',
          },
          observedAt: '2026-06-17T10:05:00.000Z',
        }),
      );

      const rows = store.listObservations('atlas-test');
      expect(first).toMatchObject({
        available: true,
        recorded: true,
        knownObservationCount: 1,
        currentObservationCount: 1,
        lastObservedAt: '2026-06-17T10:00:00.000Z',
      });
      expect(second).toMatchObject({
        available: true,
        recorded: true,
        knownObservationCount: 1,
        currentObservationCount: 2,
        lastObservedAt: '2026-06-17T10:05:00.000Z',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        first_requested_cwd: '/workspace/project',
        last_requested_cwd: '/workspace/project/nested',
        git_branch: 'feature/root-ledger',
        git_head: '89abcdef0123456789abcdef0123456789abcdef',
        first_seen_at: '2026-06-17T10:00:00.000Z',
        last_seen_at: '2026-06-17T10:05:00.000Z',
        observation_count: 2,
      });
    } finally {
      store.close();
    }
  });

  it('preserves separate observations for distinct root or worktree identities', () => {
    const dbPath = path.join(tmpDir, 'events.sqlite');
    const store = new RootLedgerStore(dbPath);

    try {
      store.recordObservation(createObservation());
      store.recordObservation(
        createObservation({
          registeredProjectRoot: '/workspace/other-project',
          git: {
            insideWorkTree: true,
            worktreeRoot: '/workspace/other-project',
            commonDir: '/workspace/.git',
            branch: 'main',
            head: 'fedcba9876543210fedcba9876543210fedcba98',
          },
          markerPath: '/workspace/other-project/.xurgo-atlas/project.json',
          markerRootPath: '/workspace/other-project',
        }),
      );

      const rows = store.listObservations('atlas-test');
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.canonical_project_root)).toEqual([
        '/workspace/project',
        '/workspace/project',
      ]);
      expect(rows.map((row) => row.registered_project_root)).toEqual([
        '/workspace/project',
        '/workspace/other-project',
      ]);
    } finally {
      store.close();
    }
  });
});
