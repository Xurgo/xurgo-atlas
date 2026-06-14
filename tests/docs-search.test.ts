import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { Project } from '../src/core/project.js';
import { createMcpServer } from '../src/mcp/create-server.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-search-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function initProject(): Promise<Project> {
  const docsDir = path.join(tmpDir, 'docs', 'atlas');
  await fs.promises.mkdir(docsDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(docsDir, 'searchable.md'),
    `# Searchable Doc\n\n## Overview\nThis managed section mentions lexical retrieval.\n\n## Details\nThe local SQLite FTS index should return this section and mentions node:sqlite for punctuation-heavy search.\n`,
    'utf-8',
  );
  await fs.promises.writeFile(
    path.join(tmpDir, 'outside-notes.md'),
    '# Outside Notes\n\nThis file should never be indexed by Atlas search.\nuniqueoutsidetoken\n',
    'utf-8',
  );

  const git = simpleGit({ baseDir: tmpDir });
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  await git.add('.');
  await git.commit('Initial source commit');
  await git.raw(['branch', '-M', 'main']);

  return Project.init({
    projectRoot: tmpDir,
    projectId: 'search-project',
    configDir: path.join(tmpDir, 'config'),
    dataDir: path.join(tmpDir, 'data'),
  });
}

async function callTool(project: Project, name: string, args: Record<string, unknown>) {
  const server = createMcpServer(project);
  const handlers = (server as unknown as {
    _requestHandlers: Map<string, (request: unknown) => Promise<unknown>>;
  })._requestHandlers;
  const call = handlers.get('tools/call');
  expect(call).toBeTypeOf('function');

  return call!({
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

describe('docs.search', () => {
  it('returns scoped lexical matches with path, heading, snippet, score, and line metadata', async () => {
    const project = await initProject();

    const response = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'lexical retrieval',
      limit: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      projectId: string;
      branch: string;
      revision: string | null;
      indexedAt: string | null;
      normalizedQuery: string;
      matchCount: number;
      results: Array<{
        path: string;
        title: string;
        heading: string | null;
        startLine: number;
        endLine: number;
        revision: string;
        snippet: string;
        score: number;
        kind: string;
      }>;
    };

    expect(payload.projectId).toBe('search-project');
    expect(payload.branch).toBe('main');
    expect(payload.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(payload.indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.normalizedQuery).toBe('lexical retrieval');
    expect(payload.matchCount).toBeGreaterThan(0);
    expect(payload.results[0]).toMatchObject({
      path: 'docs/atlas/searchable.md',
      title: 'Searchable Doc',
      revision: expect.stringMatching(/^[0-9a-f]{40}$/),
      kind: expect.stringMatching(/section|document/),
    });
    expect(payload.results[0].snippet).toContain('lexical retrieval');
    expect(typeof payload.results[0].score).toBe('number');
    expect(payload.results[0].startLine).toBeGreaterThan(0);
    expect(payload.results[0].endLine).toBeGreaterThanOrEqual(payload.results[0].startLine);
  }, 120000);

  it('does not search arbitrary repo files outside Atlas-managed docs', async () => {
    const project = await initProject();

    const response = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'uniqueoutsidetoken',
      limit: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      matchCount: number;
      results: Array<{ path: string }>;
    };

    expect(payload.matchCount).toBe(0);
    expect(payload.results).toEqual([]);
  }, 120000);

  it('handles punctuation-heavy queries without falling back to an error', async () => {
    const project = await initProject();

    const response = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'node:sqlite',
      limit: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      normalizedQuery: string;
      matchCount: number;
      results: Array<{ path: string; snippet: string }>;
    };

    expect(payload.normalizedQuery).toBe('node:sqlite');
    expect(payload.matchCount).toBeGreaterThan(0);
    expect(payload.results[0]).toMatchObject({
      path: 'docs/atlas/searchable.md',
    });
    expect(payload.results[0].snippet).toMatch(/node|sqlite/i);
  }, 120000);

  it('handles empty matches gracefully', async () => {
    const project = await initProject();

    const response = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'zzzzzznonexistenttoken',
      limit: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      matchCount: number;
      results: Array<unknown>;
    };

    expect(payload.matchCount).toBe(0);
    expect(payload.results).toEqual([]);
  }, 120000);

  it('treats blank queries as an empty search without error', async () => {
    const project = await initProject();

    const response = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: '   ',
      limit: 5,
    });

    expect(response.isError).not.toBe(true);
    const payload = JSON.parse(response.content[0].text) as {
      normalizedQuery: string;
      matchCount: number;
      results: Array<unknown>;
    };

    expect(payload.normalizedQuery).toBe('');
    expect(payload.matchCount).toBe(0);
    expect(payload.results).toEqual([]);
  }, 120000);

  it('rebuilds the branch index when the managed branch advances', async () => {
    const project = await initProject();

    const initialResponse = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'lexical retrieval',
      limit: 5,
    });

    expect(initialResponse.isError).not.toBe(true);
    const initialPayload = JSON.parse(initialResponse.content[0].text) as {
      revision: string | null;
      matchCount: number;
    };

    expect(initialPayload.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(initialPayload.matchCount).toBeGreaterThan(0);

    await project.gitStore.applyAndCommit(
      'main',
      'docs/atlas/searchable.md',
      `# Searchable Doc\n\n## Overview\nThis managed section now references refresh-only search.\n\n## Details\nThe local SQLite FTS index should refresh after this commit.\n`,
      'Update searchable doc for refresh test',
    );

    const refreshedResponse = await callTool(project, 'docs.search', {
      projectId: project.projectId,
      branch: 'main',
      query: 'refresh-only search',
      limit: 5,
    });

    expect(refreshedResponse.isError).not.toBe(true);
    const refreshedPayload = JSON.parse(refreshedResponse.content[0].text) as {
      revision: string | null;
      indexedAt: string | null;
      matchCount: number;
      results: Array<{
        path: string;
        heading: string | null;
        snippet: string;
      }>;
    };

    expect(refreshedPayload.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(refreshedPayload.revision).not.toBe(initialPayload.revision);
    expect(refreshedPayload.indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(refreshedPayload.matchCount).toBeGreaterThan(0);
    expect(refreshedPayload.results[0]).toMatchObject({
      path: 'docs/atlas/searchable.md',
      heading: 'Overview',
    });
    expect(refreshedPayload.results[0].snippet).toContain('refresh-only');
  }, 120000);
});
