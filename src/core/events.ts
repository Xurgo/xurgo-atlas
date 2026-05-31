import { DatabaseSync } from 'node:sqlite';
import * as crypto from 'node:crypto';

export interface DocEvent {
  id?: string;
  project_id: string;
  branch: string;
  path: string;
  actor?: string;
  tool_name: string;
  intent?: string;
  summary?: string;
  base_revision?: string;
  result_revision?: string;
  risk_level?: string;
  diff?: string;
  created_at?: string;
}

export interface StoredProposal {
  id: string;
  project_id: string;
  branch: string;
  path: string;
  base_revision: string;
  patch: string;
  intent: string;
  summary: string;
  risk_level: string;
  requires_approval: boolean;
  status: 'pending' | 'committed' | 'rejected' | 'stale';
  created_at: string;
  committed_at: string | null;
}

export class EventLog {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        actor TEXT,
        tool_name TEXT NOT NULL,
        intent TEXT,
        summary TEXT,
        base_revision TEXT,
        result_revision TEXT,
        risk_level TEXT,
        diff TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_events_project ON doc_events(project_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_events_path ON doc_events(path)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_events_branch ON doc_events(branch)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        patch TEXT NOT NULL,
        intent TEXT NOT NULL,
        summary TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'low',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        committed_at TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_proposals_status ON doc_proposals(status)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_proposals_project ON doc_proposals(project_id)
    `);
  }

  logEvent(event: DocEvent): DocEvent {
    const id = event.id ?? crypto.randomUUID();
    const createdAt = event.created_at ?? new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO doc_events (id, project_id, branch, path, actor, tool_name, intent, summary, base_revision, result_revision, risk_level, diff, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      event.project_id,
      event.branch,
      event.path,
      event.actor ?? null,
      event.tool_name,
      event.intent ?? null,
      event.summary ?? null,
      event.base_revision ?? null,
      event.result_revision ?? null,
      event.risk_level ?? null,
      event.diff ?? null,
      createdAt,
    );

    return { ...event, id, created_at: createdAt };
  }

  getHistory(path?: string, limit = 50): DocEvent[] {
    if (path) {
      const stmt = this.db.prepare(
        'SELECT * FROM doc_events WHERE path = ? ORDER BY created_at DESC LIMIT ?',
      );
      return stmt.all(path, limit) as unknown as DocEvent[];
    }
    const stmt = this.db.prepare(
      'SELECT * FROM doc_events ORDER BY created_at DESC LIMIT ?',
    );
    return stmt.all(limit) as unknown as DocEvent[];
  }

  getHistoryForPath(projectId: string, path: string, limit = 50): DocEvent[] {
    const stmt = this.db.prepare(
      'SELECT * FROM doc_events WHERE project_id = ? AND path = ? ORDER BY created_at DESC LIMIT ?',
    );
    return stmt.all(projectId, path, limit) as unknown as DocEvent[];
  }

  // ── Proposal Storage ─────────────────────────────────────────────────

  /**
   * Store a validated proposal and return it with a generated id and timestamp.
   */
  storeProposal(proposal: {
    project_id: string;
    branch: string;
    path: string;
    base_revision: string;
    patch: string;
    intent: string;
    summary: string;
    risk_level: string;
    requires_approval: boolean;
  }): StoredProposal {
    const id = `prop_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO doc_proposals (id, project_id, branch, path, base_revision, patch, intent, summary, risk_level, requires_approval, status, created_at, committed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
    `);

    stmt.run(
      id,
      proposal.project_id,
      proposal.branch,
      proposal.path,
      proposal.base_revision,
      proposal.patch,
      proposal.intent,
      proposal.summary,
      proposal.risk_level,
      proposal.requires_approval ? 1 : 0,
      createdAt,
    );

    return {
      id,
      ...proposal,
      requires_approval: proposal.requires_approval,
      status: 'pending',
      created_at: createdAt,
      committed_at: null,
    };
  }

  /**
   * Retrieve a stored proposal by its id.
   */
  getProposal(id: string): StoredProposal | null {
    const stmt = this.db.prepare('SELECT * FROM doc_proposals WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      project_id: row.project_id as string,
      branch: row.branch as string,
      path: row.path as string,
      base_revision: row.base_revision as string,
      patch: row.patch as string,
      intent: row.intent as string,
      summary: row.summary as string,
      risk_level: row.risk_level as string,
      requires_approval: (row.requires_approval as number) === 1,
      status: row.status as StoredProposal['status'],
      created_at: row.created_at as string,
      committed_at: (row.committed_at as string) ?? null,
    };
  }

  /**
   * Update the status of a stored proposal (e.g. 'committed', 'rejected', 'stale').
   */
  updateProposalStatus(
    id: string,
    status: StoredProposal['status'],
  ): void {
    const committedAt =
      status === 'committed' ? new Date().toISOString() : null;
    const stmt = this.db.prepare(
      'UPDATE doc_proposals SET status = ?, committed_at = ? WHERE id = ?',
    );
    stmt.run(status, committedAt, id);
  }

  close(): void {
    this.db.close();
  }
}
