import * as fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  type RecoveryObservationMetadata,
  type ProposalMetadata,
} from './events.js';
import {
  buildRootLedgerIdentityKey,
  unavailableRootLedgerSummary,
  type RootLedgerSummary,
} from './root-ledger.js';

export interface ReadOnlyRecoveryObservationRecord {
  branch: string;
  path: string;
  createdAt: string;
  metadata: RecoveryObservationMetadata | null;
}

export interface ReadOnlyRecoveryEvidence {
  available: boolean;
  pendingProposalCount: number | null;
  pendingCurrentRootProposalCount: number | null;
  pendingForeignRootProposalCount: number | null;
  pendingUnknownRootProposalCount: number | null;
  lastPreviewObservation: ReadOnlyRecoveryObservationRecord | null;
  lastExportObservation: ReadOnlyRecoveryObservationRecord | null;
  unavailableReason: string | null;
}

export async function readExistingRootLedgerSummary(
  dbPath: string,
  identity: Parameters<typeof buildRootLedgerIdentityKey>[0],
): Promise<RootLedgerSummary> {
  if (!fs.existsSync(dbPath)) {
    return unavailableRootLedgerSummary('Root ledger storage is unavailable.');
  }

  try {
    if (!await sqliteTableExists(dbPath, 'root_worktree_ledger')) {
      return unavailableRootLedgerSummary('Root ledger table is unavailable.');
    }

    const identityKey = buildRootLedgerIdentityKey(identity);
    const aggregateRows = await readSqliteJsonQuery(dbPath, `
      SELECT
        COUNT(*) AS knownObservationCount,
        COUNT(DISTINCT canonical_project_root) AS distinctCanonicalProjectRootCount,
        COUNT(DISTINCT git_worktree_root) AS distinctGitWorktreeRootCount,
        COUNT(DISTINCT git_common_dir) AS distinctGitCommonDirCount,
        MAX(last_seen_at) AS lastObservedAt
      FROM root_worktree_ledger
      WHERE project_id = ?
    `, [identity.projectId]);
    const aggregate = aggregateRows[0] as {
      knownObservationCount: number;
      distinctCanonicalProjectRootCount: number;
      distinctGitWorktreeRootCount: number;
      distinctGitCommonDirCount: number;
      lastObservedAt: string | null;
    } | undefined;
    const currentRows = await readSqliteJsonQuery(dbPath, `
      SELECT observation_count
      FROM root_worktree_ledger
      WHERE project_id = ? AND identity_key = ?
    `, [identity.projectId, identityKey]);
    const current = currentRows[0] as { observation_count: number } | undefined;

    if (!aggregate) {
      return unavailableRootLedgerSummary('Root ledger summary is unavailable.');
    }

    const multipleRootsObserved = aggregate.distinctCanonicalProjectRootCount > 1;
    const multipleWorktreesObserved = aggregate.distinctGitWorktreeRootCount > 1;
    const multipleGitCommonDirsObserved = aggregate.distinctGitCommonDirCount > 1;
    const warnings: string[] = [];

    if (multipleRootsObserved) {
      warnings.push('multiple canonical project roots observed for this project');
    }
    if (multipleWorktreesObserved) {
      warnings.push('multiple git worktree roots observed for this project');
    }
    if (multipleGitCommonDirsObserved) {
      warnings.push('multiple git common directories observed for this project');
    }

    return {
      available: true,
      recorded: current !== undefined,
      knownObservationCount: aggregate.knownObservationCount,
      currentObservationCount: current?.observation_count ?? null,
      distinctCanonicalProjectRootCount: aggregate.distinctCanonicalProjectRootCount,
      distinctGitWorktreeRootCount: aggregate.distinctGitWorktreeRootCount,
      distinctGitCommonDirCount: aggregate.distinctGitCommonDirCount,
      multipleRootsObserved,
      multipleWorktreesObserved,
      multipleGitCommonDirsObserved,
      currentObservationIsOnlyKnownIdentity: aggregate.knownObservationCount === 1,
      lastObservedAt: aggregate.lastObservedAt,
      warnings,
    };
  } catch (error) {
    return unavailableRootLedgerSummary(
      `Root ledger summary unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readRecoveryEvidence(
  dbPath: string,
  identity: Parameters<typeof buildRootLedgerIdentityKey>[0],
): Promise<ReadOnlyRecoveryEvidence> {
  if (!fs.existsSync(dbPath)) {
    return unavailableRecoveryEvidence('event log is unavailable');
  }

  try {
    if (!await sqliteTableExists(dbPath, 'doc_proposals') || !await sqliteTableExists(dbPath, 'doc_events')) {
      return unavailableRecoveryEvidence('recovery tables are unavailable');
    }

    const pendingRows = await readSqliteJsonQuery(dbPath, `
      SELECT metadata_json
      FROM doc_proposals
      WHERE project_id = ? AND status = 'pending'
    `, [identity.projectId]) as Array<{ metadata_json: string | null }>;

    const identityKey = buildRootLedgerIdentityKey(identity);
    let pendingCurrentRootProposalCount = 0;
    let pendingForeignRootProposalCount = 0;
    let pendingUnknownRootProposalCount = 0;

    for (const row of pendingRows) {
      const proposal = parseStoredProposalMetadata(row.metadata_json);
      const proposalIdentityKey = proposal?.recovery?.rootIdentityKey ?? null;

      if (!proposalIdentityKey) {
        pendingUnknownRootProposalCount += 1;
      } else if (proposalIdentityKey === identityKey) {
        pendingCurrentRootProposalCount += 1;
      } else {
        pendingForeignRootProposalCount += 1;
      }
    }

    return {
      available: true,
      pendingProposalCount: pendingRows.length,
      pendingCurrentRootProposalCount,
      pendingForeignRootProposalCount,
      pendingUnknownRootProposalCount,
      lastPreviewObservation: await readRecoveryObservation(dbPath, identity.projectId, 'preview_export'),
      lastExportObservation: await readRecoveryObservation(dbPath, identity.projectId, 'export'),
      unavailableReason: null,
    };
  } catch (error) {
    return unavailableRecoveryEvidence(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function unavailableRecoveryEvidence(reason: string): ReadOnlyRecoveryEvidence {
  return {
    available: false,
    pendingProposalCount: null,
    pendingCurrentRootProposalCount: null,
    pendingForeignRootProposalCount: null,
    pendingUnknownRootProposalCount: null,
    lastPreviewObservation: null,
    lastExportObservation: null,
    unavailableReason: reason,
  };
}

async function readRecoveryObservation(
  dbPath: string,
  projectId: string,
  toolName: 'preview_export' | 'export',
): Promise<ReadOnlyRecoveryObservationRecord | null> {
  const rows = await readSqliteJsonQuery(dbPath, `
    SELECT branch, path, created_at, metadata_json
    FROM doc_events
    WHERE project_id = ? AND tool_name = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [projectId, toolName]);
  const row = rows[0] as {
    branch: string;
    path: string;
    created_at: string;
    metadata_json: string | null;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    branch: row.branch,
    path: row.path,
    createdAt: row.created_at,
    metadata: parseRecoveryObservationMetadata(row.metadata_json),
  };
}

async function sqliteTableExists(dbPath: string, tableName: string): Promise<boolean> {
  const rows = await readSqliteJsonQuery(dbPath, `
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `, [tableName]) as Array<{ present: number }>;
  return rows.length > 0;
}

async function readSqliteJsonQuery(
  dbPath: string,
  sql: string,
  params: Array<string | number | null>,
): Promise<unknown[]> {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    return db.prepare(sql).all(...params) as unknown[];
  } finally {
    db.close();
  }
}

function parseRecoveryObservationMetadata(raw: string | null): RecoveryObservationMetadata | null {
  const value = parseJsonObject(raw);
  if (!isObject(value) || value.kind !== 'recovery_observation') {
    return null;
  }
  return value as unknown as RecoveryObservationMetadata;
}

function parseStoredProposalMetadata(raw: string | null): ProposalMetadata | null {
  const value = parseJsonObject(raw);
  if (!isObject(value)) {
    return null;
  }
  return value as ProposalMetadata;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
