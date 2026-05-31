import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Project } from '../src/core/project.js';
import { Policy } from '../src/core/policy.js';
import { GitStore } from '../src/core/git-store.js';
import { EventLog } from '../src/core/events.js';
import { validatePatch, isPathTraversal, applyUnifiedDiff } from '../src/core/patch.js';
import { assessPatchRisk } from '../src/core/risk.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docs-mcp-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('project initialization', () => {
  it('should create all expected files and directories', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    // Check .docs-mcp directory exists
    const docsMcpDir = path.join(tmpDir, '.docs-mcp');
    const stat = await fs.promises.stat(docsMcpDir);
    expect(stat.isDirectory()).toBe(true);

    // Check Git store exists
    const gitStoreDir = path.join(docsMcpDir, 'repo.git');
    const gitStat = await fs.promises.stat(gitStoreDir);
    expect(gitStat.isDirectory()).toBe(true);

    // Check SQLite events DB exists
    const eventsDb = path.join(docsMcpDir, 'events.sqlite');
    const dbStat = await fs.promises.stat(eventsDb);
    expect(dbStat.isFile()).toBe(true);

    // Check .docs-policy.yml exists
    const policyFile = path.join(tmpDir, '.docs-policy.yml');
    const policyStat = await fs.promises.stat(policyFile);
    expect(policyStat.isFile()).toBe(true);

    // Check docs directory exists
    const docsDir = path.join(tmpDir, 'docs');
    const docsStat = await fs.promises.stat(docsDir);
    expect(docsStat.isDirectory()).toBe(true);

    // Check docs/README.md exists
    const docsReadme = path.join(tmpDir, 'docs', 'README.md');
    const docsReadmeStat = await fs.promises.stat(docsReadme);
    expect(docsReadmeStat.isFile()).toBe(true);

    // Check docs/spec/README.md exists
    const specReadme = path.join(tmpDir, 'docs', 'spec', 'README.md');
    const specStat = await fs.promises.stat(specReadme);
    expect(specStat.isFile()).toBe(true);

    // Check docs/implementation-checklist.md exists
    const checklist = path.join(tmpDir, 'docs', 'implementation-checklist.md');
    const checklistStat = await fs.promises.stat(checklist);
    expect(checklistStat.isFile()).toBe(true);

    // Check AGENTS.md exists with safety rules content
    const agentsMd = path.join(tmpDir, 'AGENTS.md');
    const agentsStat = await fs.promises.stat(agentsMd);
    expect(agentsStat.isFile()).toBe(true);

    // Verify AGENTS.md contains the documentation safety rules
    const agentsContent = await fs.promises.readFile(agentsMd, 'utf-8');
    expect(agentsContent).toContain('Documentation Safety Rules');
    expect(agentsContent).toContain('docs-mcp');
    expect(agentsContent).toContain('Never directly overwrite');
    expect(agentsContent).toContain('docs.propose_patch');
    expect(agentsContent).toContain('baseRevision');

    // Verify Git store has files tracked
    const files = await project.getTrackedFiles();
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('reading docs', () => {
  it('should read a file from the Git store', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const { content, revision } = await project.readFile('main', 'docs/README.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Documentation');
    expect(revision).not.toBeNull();
  });

  it('should return null for non-existent files', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const { content } = await project.readFile('main', 'docs/nonexistent.md');
    expect(content).toBeNull();
  });
});

describe('creating branches', () => {
  it('should create a new branch from main', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    await project.gitStore.createBranch('test-branch', 'main');
    const exists = await project.gitStore.branchExists('test-branch');
    expect(exists).toBe(true);

    // Verify the branch has the same files
    const mainFiles = await project.gitStore.listFiles('main');
    const branchFiles = await project.gitStore.listFiles('test-branch');
    expect(branchFiles).toEqual(mainFiles);
  });
});

describe('proposing a valid patch', () => {
  it('should validate a correct patch proposal', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'docs/README.md';
    const { content, revision } = await project.readFile('main', filePath);

    // Create a simple patch that adds a line
    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## New Section\n\nAdded content.\n',
    );

    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Add new section to README',
      summary: 'Add a new section to the documentation README',
    });

    expect(validation.valid).toBe(true);
  });
});

describe('rejecting a stale baseRevision', () => {
  it('should reject a patch with a stale base revision', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'docs/README.md';
    const { content } = await project.readFile('main', filePath);

    // Create a patch with a fake (non-matching) base revision
    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Stale Test\n',
    );

    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: '0000000000000000000000000000000000000000',
      patch,
      intent: 'Test stale revision',
      summary: 'This should fail due to stale base revision',
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('Base revision mismatch');
  });
});

describe('rejecting path traversal', () => {
  it('should detect path traversal attempts', () => {
    expect(isPathTraversal('../etc/passwd')).toBe(true);
    expect(isPathTraversal('docs/../../etc/passwd')).toBe(true);
    expect(isPathTraversal('/etc/passwd')).toBe(true);
    expect(isPathTraversal('docs/../policy.yml')).toBe(true);
  });

  it('should accept safe paths', () => {
    expect(isPathTraversal('docs/README.md')).toBe(false);
    expect(isPathTraversal('docs/spec/design.md')).toBe(false);
    expect(isPathTraversal('AGENTS.md')).toBe(false);
    expect(isPathTraversal('docs/deeply/nested/file.md')).toBe(false);
  });
});

describe('detecting large deletion risk', () => {
  it('should flag patches that delete more than 25%', () => {
    const policy = new Policy();
    const original = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n';
    const newContent = 'line1\nline2\nline3\nline4\nline5\n';
    const patch = '--- a/file\n+++ b/file\n@@ -1,10 +1,5 @@\n';

    const risk = assessPatchRisk(policy, 'docs/test.md', original, newContent, patch);
    expect(risk.highRisk).toBe(true);
    expect(risk.reasons.some((r) => r.includes('Deletes'))).toBe(true);
  });

  it('should not flag small deletions', () => {
    const policy = new Policy();
    const original = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n';
    const newContent = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n\nextra line\n';

    // Use a non-protected path to isolate the deletion test
    const risk = assessPatchRisk(policy, 'notes/scratch.md', original, newContent, '');
    expect(risk.highRisk).toBe(false);
  });
});

describe('committing a patch', () => {
  it('should apply a patch and create a commit', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const filePath = 'docs/README.md';
    const { content, revision } = await project.readFile('main', filePath);

    // Create a simple patch
    const newContent = (content ?? '') + '\n## New Section\n\nTest content.\n';
    const patch = createSimplePatch(content ?? '', newContent);

    const result = await project.gitStore.applyPatchAndCommit(
      'main',
      filePath,
      patch,
      'Add test section to README',
      revision ?? undefined,
    );

    expect(result.hash).toBeTruthy();
    expect(result.hash.length).toBe(40); // SHA1 hash

    // Verify the file was updated
    const updated = await project.readFile('main', filePath);
    expect(updated.content).toContain('New Section');
  });
});

describe('writing an event log row', () => {
  it('should log and retrieve events', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const event = project.eventLog.logEvent({
      project_id: 'test-project',
      branch: 'main',
      path: 'docs/test.md',
      tool_name: 'commit_patch',
      intent: 'Test event logging',
      summary: 'A test event entry',
      base_revision: 'abc123',
      result_revision: 'def456',
      risk_level: 'low',
    });

    expect(event.id).toBeTruthy();

    const history = project.eventLog.getHistoryForPath('test-project', 'docs/test.md');
    expect(history.length).toBe(1);
    expect(history[0].summary).toBe('A test event entry');
  });
});

describe('restoring a file from history', () => {
  it('should restore a file to a previous revision', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const filePath = 'docs/README.md';
    const { content: originalContent, revision: originalRevision } = await project.readFile('main', filePath);

    // Make a change to the file
    const newContent = (originalContent ?? '') + '\n## Added Later\n\nThis will be reverted.\n';
    const patch = createSimplePatch(originalContent ?? '', newContent);

    await project.gitStore.applyPatchAndCommit(
      'main',
      filePath,
      patch,
      'Add section that will be reverted',
      originalRevision ?? undefined,
    );

    // Verify the change was applied
    const { content: changedContent } = await project.readFile('main', filePath);
    expect(changedContent).toContain('Added Later');

    // Restore the original revision
    await project.gitStore.restoreFile('main', filePath, originalRevision ?? '');

    // Verify the file is back to original
    const { content: restoredContent } = await project.readFile('main', filePath);
    expect(restoredContent).not.toContain('Added Later');
  });
});

describe('proposal storage', () => {
  it('should store, retrieve, and update proposal status', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const stored = project.eventLog.storeProposal({
      project_id: 'test-project',
      branch: 'main',
      path: 'docs/README.md',
      base_revision: 'abc123',
      patch: '--- a/docs/README.md\n+++ b/docs/README.md\n@@ -1 +1,2 @@\n-old\n+new\n',
      intent: 'Test proposal storage',
      summary: 'A test proposal',
      risk_level: 'low',
      requires_approval: false,
    });

    expect(stored.id).toMatch(/^prop_/);
    expect(stored.status).toBe('pending');
    expect(stored.committed_at).toBeNull();

    // Retrieve by id
    const retrieved = project.eventLog.getProposal(stored.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.path).toBe('docs/README.md');
    expect(retrieved!.status).toBe('pending');

    // Update status to committed
    project.eventLog.updateProposalStatus(stored.id, 'committed');
    const afterCommit = project.eventLog.getProposal(stored.id);
    expect(afterCommit!.status).toBe('committed');
    expect(afterCommit!.committed_at).not.toBeNull();
  });

  it('should return null for non-existent proposal', () => {
    const project = new Project({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });
    // Manually init the event log for a direct test
    const eventLog = new EventLog(path.join(tmpDir, '.docs-mcp', 'events.sqlite'));

    const result = eventLog.getProposal('prop_nonexistent');
    expect(result).toBeNull();
  });
});

describe('detecting heading removal risk', () => {
  it('should flag patches that remove Markdown headings', () => {
    const policy = new Policy();
    const original = '# Title\n\nSome content.\n## Section 1\n\nDetails.\n## Section 2\n\nMore details.\n';
    const newContent = '# Title\n\nSome content.\n## Section 1\n\nDetails.\n';

    const risk = assessPatchRisk(policy, 'docs/test.md', original, newContent, '');
    expect(risk.highRisk).toBe(true);
    expect(risk.reasons.some((r) => r.includes('heading'))).toBe(true);
  });

  it('should not flag patches that keep headings', () => {
    const policy = new Policy();
    const original = '# Title\n\nBody.\n## Section\n\nContent.\n';
    const newContent = '# Title\n\nBody.\n## Section\n\nUpdated content.\n';

    const risk = assessPatchRisk(policy, 'docs/test.md', original, newContent, '');
    // Headings are preserved, but it still modifies a protected file
    const hasHeadingRisk = risk.reasons.some((r) => r.includes('heading'));
    expect(hasHeadingRisk).toBe(false);
  });
});

describe('detecting full file replacement risk', () => {
  it('should flag patches that replace entire file content', () => {
    const policy = new Policy();
    const original = '# Original Title\n\nThis is the original content of the file.\n\nIt has multiple paragraphs.\n\nAnd some more text.\n';
    const newContent = '# Completely Different\n\nThis file has been entirely replaced.\n';

    const risk = assessPatchRisk(policy, 'docs/test.md', original, newContent, '');
    expect(risk.highRisk).toBe(true);
    expect(risk.reasons.some((r) => r.includes('replace'))).toBe(true);
  });
});

describe('exporting documentation', () => {
  it('should export files from a branch to a target directory', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const exportDir = path.join(tmpDir, 'export-output');
    const exportedFiles = await project.gitStore.exportBranch('main', exportDir);

    expect(exportedFiles.length).toBeGreaterThan(0);

    // Verify files exist on disk
    for (const file of exportedFiles) {
      const fullPath = path.join(exportDir, file);
      const stat = await fs.promises.stat(fullPath);
      expect(stat.isFile()).toBe(true);
    }
  });
});

describe('stale proposal detection', () => {
  it('should reject a proposal whose base revision is stale after another commit', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = new Policy();
    const filePath = 'docs/README.md';
    const { content, revision } = await project.readFile('main', filePath);

    // Make a first valid patch + commit
    const patch1 = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## First Change\n',
    );

    const result1 = await project.gitStore.applyPatchAndCommit(
      'main', filePath, patch1, 'First change', revision ?? undefined,
    );
    expect(result1.hash).toBeTruthy();
    expect(result1.hash.length).toBe(40);

    // Now create a proposal based on the *original* (now stale) revision
    const patch2 = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Second Change (based on stale revision)\n',
    );

    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '', // stale!
      patch: patch2,
      intent: 'Attempt change on stale base',
      summary: 'This should fail',
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('Base revision mismatch');
  });
});

describe('AGENTS.md intent validation', () => {
  it('should reject an AGENTS.md proposal with vague intent', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'AGENTS.md';
    const { content, revision } = await project.readFile('main', filePath);

    // Create a patch that modifies AGENTS.md
    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Extra Rule\n\nSomething.\n',
      'AGENTS.md',
    );

    // Vague intent that does not reference safety/agent rules
    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Update the file',
      summary: 'Minor updates to documentation',
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('AGENTS.md');
    expect(validation.error).toContain('require an intent');
  });

  it('should accept an AGENTS.md proposal with explicit safety intent (still high-risk)', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'AGENTS.md';
    const { content, revision } = await project.readFile('main', filePath);

    // Create a patch that modifies AGENTS.md
    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Extra Rule\n\nSomething.\n',
      'AGENTS.md',
    );

    // Explicit valid intent referencing safety rules
    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Update documentation safety rules in AGENTS.md',
      summary: 'Add extra safety rule for MCP docs workflow',
    });

    expect(validation.valid).toBe(true);
    expect(validation.risk).toBeDefined();
    expect(validation.risk!.highRisk).toBe(true);
    expect(validation.risk!.reasons.some((r) => r.includes('AGENTS.md'))).toBe(true);
  });

  it('should accept AGENTS.md intent referencing agent instructions via summary', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'AGENTS.md';
    const { content, revision } = await project.readFile('main', filePath);

    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Extra Rule\n\nSomething.\n',
      'AGENTS.md',
    );

    // Valid via the summary field
    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Make changes',
      summary: 'Update project agent rules to cover new workflow',
    });

    expect(validation.valid).toBe(true);
    expect(validation.risk!.highRisk).toBe(true);
  });

  it('should accept AGENTS.md intent referencing docs safety via intent', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'AGENTS.md';
    const { content, revision } = await project.readFile('main', filePath);

    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Extra Rule\n\nSomething.\n',
      'AGENTS.md',
    );

    // Valid via intent with "docs safety"
    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Improve docs safety by clarifying rules',
      summary: 'Minor edits',
    });

    expect(validation.valid).toBe(true);
    expect(validation.risk!.highRisk).toBe(true);
  });

  it('should not require AGENTS.md intent validation for non-AGENTS.md files', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });

    const policy = await Policy.load(tmpDir);
    const filePath = 'docs/README.md';
    const { content, revision } = await project.readFile('main', filePath);

    const patch = createSimplePatch(
      content ?? '',
      (content ?? '') + '\n## Extra Section\n\nMore content.\n',
    );

    // Vague intent but NOT AGENTS.md — should pass validation normally
    const validation = await validatePatch(policy, project.gitStore, {
      projectId: 'test-project',
      branch: 'main',
      path: filePath,
      baseRevision: revision ?? '',
      patch,
      intent: 'Update the file',
      summary: 'Make some changes',
    });

    expect(validation.valid).toBe(true);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function createSimplePatch(original: string, updated: string, filePath = 'docs/README.md'): string {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');

  // A unified diff with a single hunk covering the entire diff region
  const maxLen = Math.max(origLines.length, newLines.length);

  // Find first and last differing lines to minimize hunk size
  let firstDiff = maxLen;
  let lastDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    const o = i < origLines.length ? origLines[i] : '';
    const n = i < newLines.length ? newLines[i] : '';
    if (o !== n) {
      firstDiff = Math.min(firstDiff, i);
      lastDiff = Math.max(lastDiff, i);
    }
  }

  // Include some context around the diff
  const ctxStart = Math.max(0, firstDiff - 1);
  const ctxEnd = Math.min(maxLen, lastDiff + 2);

  const oldStart = ctxStart + 1;
  const oldCount = Math.min(origLines.length - ctxStart, ctxEnd - ctxStart);
  const newStart = ctxStart + 1;
  const newCount = Math.min(newLines.length - ctxStart, ctxEnd - ctxStart);

  let patch = `--- a/${filePath}\n+++ b/${filePath}\n`;
  patch += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;

  for (let i = ctxStart; i < ctxEnd; i++) {
    const o = i < origLines.length ? origLines[i] : null;
    const n = i < newLines.length ? newLines[i] : null;

    if (o === null && n !== null) {
      patch += `+${n}\n`;
    } else if (o !== null && n === null) {
      patch += `-${o}\n`;
    } else if (o !== null && n !== null && o !== n) {
      patch += `-${o}\n`;
      patch += `+${n}\n`;
    } else if (o !== null && n !== null) {
      patch += ` ${o}\n`;
    }
  }

  return patch;
}
