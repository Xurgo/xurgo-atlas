import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Project } from './project.js';
import {
  collectMarkdownHeadings,
  getMarkdownDocumentTitle,
} from './markdown.js';

export interface DocsSearchResult {
  path: string;
  title: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  revision: string;
  snippet: string;
  score: number;
  kind: 'document' | 'section';
}

export interface DocsSearchResponse {
  projectId: string;
  branch: string;
  revision: string | null;
  indexedAt: string | null;
  query: string;
  normalizedQuery: string;
  matchCount: number;
  results: DocsSearchResult[];
}

interface SearchStateRow {
  source_revision: string;
  indexed_at: string;
}

interface SearchRecord {
  path: string;
  revision: string;
  title: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
  kind: 'document' | 'section';
}

export class DocsSearchIndex {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.init();
  }

  async search(
    project: Project,
    branch: string,
    query: string,
    limit: number,
  ): Promise<DocsSearchResponse> {
    const normalizedQuery = normalizeSearchQuery(query);
    const branchRevision = await project.gitStore.getBranchHead(branch);
    const indexedAt = branchRevision
      ? await this.ensureBranchIndex(project, branch, branchRevision)
      : null;

    if (!normalizedQuery.normalizedQuery) {
      return {
        projectId: project.projectId,
        branch,
        revision: branchRevision,
        indexedAt,
        query,
        normalizedQuery: '',
        matchCount: 0,
        results: [],
      };
    }

    const ftsQuery = buildFtsQuery(normalizedQuery.normalizedQuery);
    if (!ftsQuery) {
      return {
        projectId: project.projectId,
        branch,
        revision: branchRevision,
        indexedAt,
        query,
        normalizedQuery: normalizedQuery.normalizedQuery,
        matchCount: 0,
        results: [],
      };
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          d.path,
          d.title,
          d.heading,
          d.start_line,
          d.end_line,
          d.revision,
          d.kind,
          d.content,
          bm25(docs_search_fts) AS raw_score
        FROM docs_search_fts
        JOIN docs_search_docs d ON d.id = docs_search_fts.rowid
        WHERE d.branch = ?
          AND docs_search_fts MATCH ?
        ORDER BY raw_score ASC, d.path ASC, d.start_line ASC
        LIMIT ?
        `,
      )
      .all(branch, ftsQuery, limit) as Array<{
      path: string;
      title: string;
      heading: string | null;
      start_line: number;
      end_line: number;
      revision: string;
      kind: 'document' | 'section';
      content: string;
      raw_score: number;
    }>;

    const results = rows.map((row) => ({
      path: row.path,
      title: row.title,
      heading: row.heading,
      startLine: row.start_line,
      endLine: row.end_line,
      revision: row.revision,
      snippet: buildSearchExcerpt(row.content, normalizedQuery.normalizedQuery),
      score: scoreFromBm25(row.raw_score),
      kind: row.kind,
    }));

    return {
      projectId: project.projectId,
      branch,
      revision: branchRevision,
      indexedAt,
      query,
      normalizedQuery: normalizedQuery.normalizedQuery,
      matchCount: results.length,
      results,
    };
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs_search_state (
        branch TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs_search_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        revision TEXT NOT NULL,
        title TEXT NOT NULL,
        heading TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_docs_search_docs_branch_path
      ON docs_search_docs(branch, path)
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_search_fts USING fts5(
        title,
        heading,
        content,
        content='',
        tokenize='unicode61 remove_diacritics 2'
      )
    `);
  }

  private async ensureBranchIndex(
    project: Project,
    branch: string,
    branchRevision: string,
  ): Promise<string | null> {
    const state = this.getIndexState(branch);
    if (state?.source_revision === branchRevision) {
      return state.indexed_at;
    }

    await this.rebuildBranchIndex(project, branch, branchRevision);
    return this.getIndexState(branch)?.indexed_at ?? null;
  }

  private async rebuildBranchIndex(
    project: Project,
    branch: string,
    branchRevision: string,
  ): Promise<void> {
    const ownedFiles = await project.getOwnedFiles(branch);
    const records: SearchRecord[] = [];

    for (const filePath of ownedFiles) {
      const { content, revision } = await project.readFile(branch, filePath);
      if (content === null) {
        continue;
      }

      const currentRevision = revision ?? branchRevision;
      const title = getMarkdownDocumentTitle(content, path.basename(filePath));
      const lines = content.split('\n');
      const headings = collectMarkdownHeadings(content);

      if (headings.length === 0) {
        records.push({
          path: filePath,
          revision: currentRevision,
          title,
          heading: null,
          startLine: 1,
          endLine: countLines(content),
          content,
          kind: 'document',
        });
        continue;
      }

      if (headings[0].index > 0) {
        const preamble = lines.slice(0, headings[0].index).join('\n');
        if (preamble.trim().length === 0) {
          continue;
        }
        records.push({
          path: filePath,
          revision: currentRevision,
          title,
          heading: null,
          startLine: 1,
          endLine: headings[0].line - 1,
          content: preamble,
          kind: 'document',
        });
      }

      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const nextHeading = headings.find(
          (candidate) =>
            candidate.index > heading.index && candidate.level <= heading.level,
        );
        const endIndex = nextHeading ? nextHeading.index : lines.length;
        records.push({
          path: filePath,
          revision: currentRevision,
          title,
          heading: heading.text,
          startLine: heading.line,
          endLine: nextHeading ? nextHeading.line - 1 : countLines(content),
          content: lines.slice(heading.index, endIndex).join('\n'),
          kind: 'section',
        });
      }
    }

    const now = new Date().toISOString();
    const existingIds = this.db
      .prepare('SELECT id FROM docs_search_docs WHERE branch = ?')
      .all(branch) as Array<{ id: number }>;

    const deleteFts = this.db.prepare('DELETE FROM docs_search_fts WHERE rowid = ?');
    for (const row of existingIds) {
      deleteFts.run(row.id);
    }

    this.db.prepare('DELETE FROM docs_search_docs WHERE branch = ?').run(branch);

    const insertDoc = this.db.prepare(`
      INSERT INTO docs_search_docs (
        branch, path, revision, title, heading, start_line, end_line, kind, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO docs_search_fts (rowid, title, heading, content)
      VALUES (?, ?, ?, ?)
    `);
    const upsertState = this.db.prepare(`
      INSERT INTO docs_search_state (branch, source_revision, indexed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(branch) DO UPDATE SET
        source_revision = excluded.source_revision,
        indexed_at = excluded.indexed_at
    `);

    this.db.exec('BEGIN');
    try {
      for (const record of records) {
        const result = insertDoc.run(
          branch,
          record.path,
          record.revision,
          record.title,
          record.heading,
          record.startLine,
          record.endLine,
          record.kind,
          record.content,
        );
        const rowId = Number(result.lastInsertRowid);
        insertFts.run(rowId, record.title, record.heading, record.content);
      }

      upsertState.run(branch, branchRevision, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private getIndexState(branch: string): SearchStateRow | null {
    const row = this.db
      .prepare(
        'SELECT source_revision, indexed_at FROM docs_search_state WHERE branch = ?',
      )
      .get(branch) as SearchStateRow | undefined;
    return row ?? null;
  }
}

function normalizeSearchQuery(query: string): {
  normalizedQuery: string;
} {
  return {
    normalizedQuery: query.trim().replace(/\s+/g, ' '),
  };
}

function buildFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter((term) => term.length > 0)
    .slice(0, 12);

  if (terms.length === 0) {
    return '';
  }

  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

function scoreFromBm25(score: number): number {
  const normalized = Number.isFinite(score) ? Math.max(score, 0) : 0;
  return Number((1 / (1 + normalized)).toFixed(6));
}

function buildSearchExcerpt(content: string, query: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  if (normalizedContent.length === 0) {
    return '';
  }

  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const candidates = [
    normalizedQuery,
    ...normalizedQuery.split(' '),
  ].filter((candidate) => candidate.length > 0);

  let matchIndex = -1;
  let matchedTerm = '';
  const lowerContent = normalizedContent.toLowerCase();

  for (const candidate of candidates) {
    const index = lowerContent.indexOf(candidate.toLowerCase());
    if (index >= 0) {
      matchIndex = index;
      matchedTerm = candidate;
      break;
    }
  }

  if (matchIndex < 0) {
    return normalizedContent.slice(0, 180);
  }

  const before = Math.max(0, matchIndex - 40);
  const after = Math.min(
    normalizedContent.length,
    matchIndex + matchedTerm.length + 80,
  );
  let excerpt = normalizedContent.slice(before, after).trim();

  if (before > 0) {
    excerpt = `…${excerpt}`;
  }
  if (after < normalizedContent.length) {
    excerpt = `${excerpt}…`;
  }

  return excerpt.replace(
    new RegExp(escapeRegExp(matchedTerm), 'ig'),
    (match) => `[${match}]`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split('\n');
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
}
