import * as fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { GitIdentity } from './git-identity.js';

export interface RootLedgerSafetySnapshot {
  safeForWrites: boolean;
  ambiguous: boolean;
  rootMismatch: boolean;
  markerMismatch: boolean;
  markerMissing: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
  warnings: string[];
}

export interface RootLedgerObservation {
  projectId: string;
  requestedCwd: string;
  projectRoot: string;
  canonicalProjectRoot: string;
  registeredProjectRoot: string | null;
  daemonProjectRoot: string | null;
  markerPath: string;
  markerRootPath: string | null;
  markerProjectId: string | null;
  git: GitIdentity;
  safety: RootLedgerSafetySnapshot;
  observedAt?: string;
}

export interface RootLedgerEntry {
  project_id: string;
  identity_key: string;
  first_requested_cwd: string;
  last_requested_cwd: string;
  project_root: string;
  canonical_project_root: string;
  registered_project_root: string | null;
  daemon_project_root: string | null;
  marker_path: string;
  marker_root_path: string | null;
  marker_project_id: string | null;
  git_worktree_root: string | null;
  git_common_dir: string | null;
  git_branch: string | null;
  git_head: string | null;
  safe_for_writes: number;
  ambiguous: number;
  root_mismatch: number;
  marker_missing: number;
  marker_mismatch: number;
  registered_project_root_missing: number;
  registered_project_root_mismatch: number;
  daemon_project_root_mismatch: number;
  git_mismatch: number;
  git_unavailable: number;
  warnings_json: string;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
}

export interface RootLedgerSummary {
  available: boolean;
  recorded: boolean;
  knownObservationCount: number | null;
  currentObservationCount: number | null;
  lastObservedAt: string | null;
  warnings: string[];
}

export class RootLedgerStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  recordObservation(observation: RootLedgerObservation): RootLedgerSummary {
    const observedAt = observation.observedAt ?? new Date().toISOString();
    const identityKey = buildObservationIdentityKey(observation);
    const warningsJson = JSON.stringify(observation.safety.warnings);

    const upsert = this.db.prepare(`
      INSERT INTO root_worktree_ledger (
        project_id,
        identity_key,
        first_requested_cwd,
        last_requested_cwd,
        project_root,
        canonical_project_root,
        registered_project_root,
        daemon_project_root,
        marker_path,
        marker_root_path,
        marker_project_id,
        git_worktree_root,
        git_common_dir,
        git_branch,
        git_head,
        safe_for_writes,
        ambiguous,
        root_mismatch,
        marker_missing,
        marker_mismatch,
        registered_project_root_missing,
        registered_project_root_mismatch,
        daemon_project_root_mismatch,
        git_mismatch,
        git_unavailable,
        warnings_json,
        first_seen_at,
        last_seen_at,
        observation_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(project_id, identity_key) DO UPDATE SET
        last_requested_cwd = excluded.last_requested_cwd,
        project_root = excluded.project_root,
        canonical_project_root = excluded.canonical_project_root,
        registered_project_root = excluded.registered_project_root,
        daemon_project_root = excluded.daemon_project_root,
        marker_path = excluded.marker_path,
        marker_root_path = excluded.marker_root_path,
        marker_project_id = excluded.marker_project_id,
        git_worktree_root = excluded.git_worktree_root,
        git_common_dir = excluded.git_common_dir,
        git_branch = excluded.git_branch,
        git_head = excluded.git_head,
        safe_for_writes = excluded.safe_for_writes,
        ambiguous = excluded.ambiguous,
        root_mismatch = excluded.root_mismatch,
        marker_missing = excluded.marker_missing,
        marker_mismatch = excluded.marker_mismatch,
        registered_project_root_missing = excluded.registered_project_root_missing,
        registered_project_root_mismatch = excluded.registered_project_root_mismatch,
        daemon_project_root_mismatch = excluded.daemon_project_root_mismatch,
        git_mismatch = excluded.git_mismatch,
        git_unavailable = excluded.git_unavailable,
        warnings_json = excluded.warnings_json,
        last_seen_at = excluded.last_seen_at,
        observation_count = root_worktree_ledger.observation_count + 1
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run(
        observation.projectId,
        identityKey,
        observation.requestedCwd,
        observation.requestedCwd,
        observation.projectRoot,
        observation.canonicalProjectRoot,
        observation.registeredProjectRoot,
        observation.daemonProjectRoot,
        observation.markerPath,
        observation.markerRootPath,
        observation.markerProjectId,
        observation.git.worktreeRoot,
        observation.git.commonDir,
        observation.git.branch,
        observation.git.head,
        toSqliteBool(observation.safety.safeForWrites),
        toSqliteBool(observation.safety.ambiguous),
        toSqliteBool(observation.safety.rootMismatch),
        toSqliteBool(observation.safety.markerMissing),
        toSqliteBool(observation.safety.markerMismatch),
        toSqliteBool(observation.safety.registeredProjectRootMissing),
        toSqliteBool(observation.safety.registeredProjectRootMismatch),
        toSqliteBool(observation.safety.daemonProjectRootMismatch),
        toSqliteBool(observation.safety.gitMismatch),
        toSqliteBool(observation.safety.gitUnavailable),
        warningsJson,
        observedAt,
        observedAt,
      );

      const current = this.db.prepare(
        `
        SELECT *
        FROM root_worktree_ledger
        WHERE project_id = ? AND identity_key = ?
        `,
      ).get(observation.projectId, identityKey) as RootLedgerEntry | undefined;

      const countRow = this.db.prepare(
        'SELECT COUNT(*) AS count FROM root_worktree_ledger WHERE project_id = ?',
      ).get(observation.projectId) as { count: number };

      this.db.exec('COMMIT');

      return {
        available: true,
        recorded: true,
        knownObservationCount: countRow.count,
        currentObservationCount: current?.observation_count ?? null,
        lastObservedAt: current?.last_seen_at ?? observedAt,
        warnings: [],
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listObservations(projectId: string): RootLedgerEntry[] {
    const stmt = this.db.prepare(
      `
      SELECT *
      FROM root_worktree_ledger
      WHERE project_id = ?
      ORDER BY first_seen_at ASC, identity_key ASC
      `,
    );

    return stmt.all(projectId) as unknown as RootLedgerEntry[];
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS root_worktree_ledger (
        project_id TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        first_requested_cwd TEXT NOT NULL,
        last_requested_cwd TEXT NOT NULL,
        project_root TEXT NOT NULL,
        canonical_project_root TEXT NOT NULL,
        registered_project_root TEXT,
        daemon_project_root TEXT,
        marker_path TEXT NOT NULL,
        marker_root_path TEXT,
        marker_project_id TEXT,
        git_worktree_root TEXT,
        git_common_dir TEXT,
        git_branch TEXT,
        git_head TEXT,
        safe_for_writes INTEGER NOT NULL,
        ambiguous INTEGER NOT NULL,
        root_mismatch INTEGER NOT NULL,
        marker_missing INTEGER NOT NULL,
        marker_mismatch INTEGER NOT NULL,
        registered_project_root_missing INTEGER NOT NULL,
        registered_project_root_mismatch INTEGER NOT NULL,
        daemon_project_root_mismatch INTEGER NOT NULL,
        git_mismatch INTEGER NOT NULL,
        git_unavailable INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        observation_count INTEGER NOT NULL,
        PRIMARY KEY (project_id, identity_key)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_root_worktree_ledger_project_last_seen
      ON root_worktree_ledger(project_id, last_seen_at DESC)
    `);
  }
}

export function unavailableRootLedgerSummary(...warnings: string[]): RootLedgerSummary {
  return {
    available: false,
    recorded: false,
    knownObservationCount: null,
    currentObservationCount: null,
    lastObservedAt: null,
    warnings: warnings.filter((warning) => warning.length > 0),
  };
}

export function recordRootObservationIfPossible(
  dbPath: string,
  observation: RootLedgerObservation,
): RootLedgerSummary {
  if (!fs.existsSync(dbPath)) {
    return unavailableRootLedgerSummary(
      `Root ledger storage is unavailable because ${dbPath} does not exist.`,
    );
  }

  const store = new RootLedgerStore(dbPath);
  try {
    return store.recordObservation(observation);
  } finally {
    store.close();
  }
}

export function buildObservationIdentityKey(observation: RootLedgerObservation): string {
  return JSON.stringify({
    projectId: observation.projectId,
    canonicalProjectRoot: observation.canonicalProjectRoot,
    registeredProjectRoot: observation.registeredProjectRoot,
    daemonProjectRoot: observation.daemonProjectRoot,
    markerProjectId: observation.markerProjectId,
    markerRootPath: observation.markerRootPath,
    gitWorktreeRoot: observation.git.worktreeRoot,
    gitCommonDir: observation.git.commonDir,
  });
}

function toSqliteBool(value: boolean): number {
  return value ? 1 : 0;
}
