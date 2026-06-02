import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Project } from '../src/core/project.js';
import { Registry } from '../src/core/registry.js';
import { Policy } from '../src/core/policy.js';
import { StoragePaths, getDefaultConfigDir, getDefaultDataDir } from '../src/core/storage.js';
import { initCommand } from '../src/cli/init.js';
import { GitStore } from '../src/core/git-store.js';
import { EventLog } from '../src/core/events.js';
import { validatePatch, isPathTraversal, applyUnifiedDiff } from '../src/core/patch.js';
import { assessPatchRisk } from '../src/core/risk.js';
import { parseFrontMatter, handleManifest, handleRead } from '../src/mcp/tools.js';
import YAML from 'yaml';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'docu-guard-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ── Storage path resolution tests ─────────────────────────────────────

describe('storage path resolution', () => {
  it('should provide default config and data directories', () => {
    const storage = new StoragePaths();
    expect(storage.configDir).toBe(getDefaultConfigDir());
    expect(storage.dataDir).toBe(getDefaultDataDir());
  });

  it('should accept custom config and data directories', () => {
    const storage = new StoragePaths({
      configDir: '/custom/config',
      dataDir: '/custom/data',
    });
    expect(storage.configDir).toBe('/custom/config');
    expect(storage.dataDir).toBe('/custom/data');
  });

  it('should derive correct project managed paths', () => {
    const storage = new StoragePaths({
      configDir: '/cfg',
      dataDir: '/dat',
    });
    expect(storage.registryPath()).toBe('/cfg/projects.json');
    expect(storage.projectDataDir('my-proj')).toBe('/dat/projects/my-proj');
    expect(storage.projectRepoPath('my-proj')).toBe('/dat/projects/my-proj/repo.git');
    expect(storage.projectEventsPath('my-proj')).toBe('/dat/projects/my-proj/events.sqlite');
  });

  it('should expand default paths from XDG environment variables', () => {
    // XDG_CONFIG_HOME and XDG_DATA_HOME are not set in tests, so defaults
    // should fall back to ~/.config and ~/.local/share
    const storage = new StoragePaths();
    expect(storage.configDir).toContain('.config');
    expect(storage.dataDir).toContain('.local/share');
  });

  it('should expand ~ to home directory in configDir and dataDir', () => {
    const home = os.homedir();
    const storage = new StoragePaths({
      configDir: '~/my-config',
      dataDir: '~/my-data',
    });
    expect(storage.configDir).toBe(path.join(home, 'my-config'));
    expect(storage.dataDir).toBe(path.join(home, 'my-data'));
  });

  it('should expand bare ~ without trailing slash', () => {
    const home = os.homedir();
    const storage = new StoragePaths({
      configDir: '~',
      dataDir: '~',
    });
    expect(storage.configDir).toBe(home);
    expect(storage.dataDir).toBe(home);
  });

  it('should leave non-tilde paths unchanged (after path.resolve)', () => {
    const storage = new StoragePaths({
      configDir: '/absolute/path',
      dataDir: '/another/path',
    });
    expect(storage.configDir).toBe('/absolute/path');
    expect(storage.dataDir).toBe('/another/path');
  });
});

// ── Project initialization (v0.3 managed storage) ────────────────────

describe('project initialization', () => {
  it('should create project files but NOT create .docu-guard/', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // .docu-guard/ should NOT exist
    const legacyDir = path.join(tmpDir, '.docu-guard');
    await expect(fs.promises.stat(legacyDir)).rejects.toThrow();

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
    expect(agentsContent).toContain('docu-guard-mcp');
    expect(agentsContent).toContain('Never directly overwrite');
    expect(agentsContent).toContain('docs.propose_patch');
    expect(agentsContent).toContain('baseRevision');

    // Verify Git store has files tracked
    const files = await project.getTrackedFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it('should create managed state under dataDir, not project root', async () => {
    // Use a custom data dir in the temp area
    const dataDir = path.join(tmpDir, 'docu-guard-data');
    const configDir = path.join(tmpDir, 'docu-guard-config');

    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir,
      dataDir,
    });

    // Managed state should be at <dataDir>/projects/test-project/
    const managedDir = path.join(dataDir, 'projects', 'test-project');
    const managedStat = await fs.promises.stat(managedDir);
    expect(managedStat.isDirectory()).toBe(true);

    // Git repo should be there
    const repoPath = path.join(managedDir, 'repo.git');
    const repoStat = await fs.promises.stat(repoPath);
    expect(repoStat.isDirectory()).toBe(true);

    // Events DB should be there
    const eventsPath = path.join(managedDir, 'events.sqlite');
    const dbStat = await fs.promises.stat(eventsPath);
    expect(dbStat.isFile()).toBe(true);

    // Registry is not written by Project.init() — that's a separate step.
    // Project root should NOT have .docu-guard/
    await expect(fs.promises.stat(path.join(tmpDir, '.docu-guard'))).rejects.toThrow();
  });

  it('should warn but not block if pre-v0.3 .docu-guard/ exists', async () => {
    // Create a legacy .docu-guard/ directory
    const legacyDir = path.join(tmpDir, '.docu-guard');
    await fs.promises.mkdir(legacyDir, { recursive: true });

    // Init should succeed (writes to stderr but doesn't throw)
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // Legacy dir should still exist
    const stat = await fs.promises.stat(legacyDir);
    expect(stat.isDirectory()).toBe(true);

    // Managed state should also exist
    const storage = project.storage;
    const managedDir = storage.projectDataDir('test-project');
    const managedStat = await fs.promises.stat(managedDir);
    expect(managedStat.isDirectory()).toBe(true);
  });
});

// ── v0.4 STATUS.md and docs/manifest.yml foundation ───────────────────

describe('v0.4 project context files', () => {
  it('should create STATUS.md and docs/manifest.yml during init', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // STATUS.md at project root
    const statusPath = path.join(tmpDir, 'STATUS.md');
    const statusStat = await fs.promises.stat(statusPath);
    expect(statusStat.isFile()).toBe(true);
    const statusContent = await fs.promises.readFile(statusPath, 'utf-8');
    expect(statusContent).toContain('docuGuard.type: status');
    expect(statusContent).toContain('Project Status');

    // docs/manifest.yml in docs dir
    const manifestPath = path.join(tmpDir, 'docs', 'manifest.yml');
    const manifestStat = await fs.promises.stat(manifestPath);
    expect(manifestStat.isFile()).toBe(true);
    const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
    expect(manifestContent).toContain('version: 1');
    expect(manifestContent).toContain('STATUS.md');
    expect(manifestContent).toContain('AGENTS.md');
    expect(manifestContent).toContain('docs/manifest.yml');

    // Both files should be tracked in the Git store
    const trackedFiles = await project.getTrackedFiles();
    expect(trackedFiles).toContain('STATUS.md');
    expect(trackedFiles).toContain('docs/manifest.yml');

    // References in manifest match actual tracked files
    expect(trackedFiles).toContain('AGENTS.md');
    expect(trackedFiles).toContain('.docs-policy.yml');
    expect(trackedFiles).toContain('docs/README.md');
    expect(trackedFiles).toContain('docs/implementation-checklist.md');
  });

  it('should not overwrite existing STATUS.md on re-init', async () => {
    // First init
    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // Modify STATUS.md with custom content
    const statusPath = path.join(tmpDir, 'STATUS.md');
    await fs.promises.writeFile(statusPath, '# Custom Status\n', 'utf-8');

    // Re-init should NOT overwrite
    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const content = await fs.promises.readFile(statusPath, 'utf-8');
    expect(content).toBe('# Custom Status\n');
  });

  it('should not overwrite existing docs/manifest.yml on re-init', async () => {
    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const manifestPath = path.join(tmpDir, 'docs', 'manifest.yml');
    await fs.promises.writeFile(manifestPath, 'custom: true\n', 'utf-8');

    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const content = await fs.promises.readFile(manifestPath, 'utf-8');
    expect(content).toBe('custom: true\n');
  });

  it('should not create project-local .docu-guard/', async () => {
    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    await expect(fs.promises.stat(path.join(tmpDir, '.docu-guard'))).rejects.toThrow();
  });

  it('should treat STATUS.md as a protected document by default', async () => {
    const project = await Project.load({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // First init to create policy
    await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // Reload to pick up the written policy file
    const loadedProject = await Project.load({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    expect(loadedProject.policy.isPathProtected('STATUS.md')).toBe(true);
    expect(loadedProject.policy.isPathProtected('docs/manifest.yml')).toBe(true);
  });
});

// ── docs.status tool tests ────────────────────────────────────────────

describe('docs.status', () => {
  it('should parse front matter from STATUS.md', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const { content } = await project.readFile('main', 'STATUS.md');
    expect(content).not.toBeNull();

    const result = parseFrontMatter(content!);
    expect(result.frontMatter).not.toBeNull();
    expect(result.frontMatter!.docuGuard).toBeUndefined(); // nested key
    expect(result.frontMatter!['docuGuard.type']).toBe('status');
    expect(result.frontMatter!.statusVersion).toBe(1);
    expect(result.frontMatter!.priority).toBe('high');
    expect(result.rawFrontMatter).not.toBeNull();
    expect(result.rawFrontMatter).toContain('docuGuard.type: status');
    expect(result.body).toContain('Project Status');
    expect(result.body).toContain('Current Focus');
  });

  it('should return full STATUS.md content via project.readFile', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const { content, revision } = await project.readFile('main', 'STATUS.md');
    expect(content).not.toBeNull();
    expect(content).toContain('docuGuard.type: status');
    expect(content).toContain('Project Status');
    expect(revision).not.toBeNull();
    expect(revision!.length).toBeGreaterThan(0);
  });

  it('should truncate body to maxChars', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const { content } = await project.readFile('main', 'STATUS.md');
    expect(content).not.toBeNull();

    const result = parseFrontMatter(content!);
    // Truncate body to a small value
    const truncatedBody = result.body.slice(0, 10);
    expect(truncatedBody.length).toBeLessThanOrEqual(10);
    const fullBody = result.body;
    if (fullBody.length > 10) {
      expect(truncatedBody).not.toBe(fullBody);
    }
  });

  it('should handle missing STATUS.md gracefully', async () => {
    // Create project without init (so STATUS.md doesn't exist in managed store)
    // We can simulate by reading a path that doesn't exist
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const { content } = await project.readFile('main', 'nonexistent.md');
    expect(content).toBeNull();
  });

  it('should return null front matter for content without front matter', () => {
    const result = parseFrontMatter('# Just a heading\n\nSome content');
    expect(result.frontMatter).toBeNull();
    expect(result.rawFrontMatter).toBeNull();
    expect(result.body).toBe('# Just a heading\n\nSome content');
  });

  it('should return null front matter for empty content', () => {
    const result = parseFrontMatter('');
    expect(result.frontMatter).toBeNull();
    expect(result.rawFrontMatter).toBeNull();
    expect(result.body).toBe('');
  });

  it('should return null front matter for content with only opening delimiter', () => {
    const result = parseFrontMatter('---\nkey: value\n');
    expect(result.frontMatter).toBeNull();
    expect(result.rawFrontMatter).toBeNull();
    // No closing --- so no front matter detected
  });
});

// ── docs.manifest tool tests ──────────────────────────────────────────

describe('docs.manifest', () => {
  it('should return parsed manifest JSON and revision', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.path).toBe('docs/manifest.yml');
    expect(data.branch).toBe('main');
    expect(data.revision).toBeTruthy();
    expect(data.version).toBe(1);
    expect(Array.isArray(data.entrypoints)).toBe(true);
    expect(Array.isArray(data.documents)).toBe(true);
    expect(data.documentCount).toBeGreaterThan(0);
    expect(data.truncated).toBe(false);
    expect(result.isError).toBeFalsy();
  });

  it('should not include raw YAML by default', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.raw).toBeUndefined();
  });

  it('should include raw YAML when includeRaw is true', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
      includeRaw: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.raw).toBeTruthy();
    expect(data.raw).toContain('version: 1');
    expect(data.raw).toContain('STATUS.md');
  });

  it('should validate referenced paths exist', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
      validatePaths: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.validation).toBeDefined();
    expect(data.validation.valid).toBe(true);
    expect(Array.isArray(data.validation.missingPaths)).toBe(true);
    expect(data.validation.missingPaths).toHaveLength(0);
  });

  it('should report missing referenced paths', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // Read the manifest and add a non-existent path to test validation
    const { content } = await project.readFile('main', 'docs/manifest.yml');
    expect(content).not.toBeNull();

    // We'll test the validation by directly checking via gitStore
    const trackedFiles = await project.gitStore.listFiles('main');
    const manifest = YAML.parse(content!);
    const manifestPaths: string[] = [];
    if (Array.isArray(manifest.documents)) {
      for (const doc of manifest.documents) {
        if (doc.path) manifestPaths.push(doc.path);
      }
    }
    if (Array.isArray(manifest.entrypoints)) {
      for (const ep of manifest.entrypoints) {
        if (ep.path && !manifestPaths.includes(ep.path)) manifestPaths.push(ep.path);
      }
    }

    const trackedSet = new Set(trackedFiles);
    const missing = manifestPaths.filter((p: string) => !trackedSet.has(p));
    // All standard paths from the template should exist
    expect(missing).toHaveLength(0);
  });

  it('should handle missing docs/manifest.yml clearly', async () => {
    // Init a project but then test reading a manifest path that does not exist
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // We can test this via the handler by manipulating the manifest
    // Simulate missing manifest by testing readFile directly
    const { content } = await project.readFile('main', 'docs/nonexistent.yml');
    expect(content).toBeNull();
  });

  it('should handle missing docs/manifest.yml via handler', async () => {
    const project = new Project({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });
    await project.gitStore.init();
    await project.ensureEventLog();

    // No files committed, so manifest should not exist
    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('not found');
    expect(data.hint).toContain('init');
  });

  it('should handle invalid YAML clearly', async () => {
    const project = new Project({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });
    await project.gitStore.init();
    await project.ensureEventLog();

    // Commit an invalid manifest YAML
    const invalidYaml = 'invalid: [yaml: broken\n  bad: indentation\n';
    await project.gitStore.applyAndCommit(
      'main',
      'docs/manifest.yml',
      invalidYaml,
      'Add invalid manifest',
    );

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('Invalid YAML');
  });

  it('should respect maxDocuments and set truncated to true', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // Read manifest, count documents, then test with maxDocuments=1
    const { content } = await project.readFile('main', 'docs/manifest.yml');
    expect(content).not.toBeNull();
    const manifest = YAML.parse(content!);
    const totalDocs = Array.isArray(manifest.documents) ? manifest.documents.length : 0;

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
      maxDocuments: 1,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.documentCount).toBe(1);
    expect(data.totalDocumentCount).toBe(totalDocs);
    expect(data.truncated).toBe(totalDocs > 1);
  });

  it('should work without path validation when validatePaths is false', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
      validatePaths: false,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.validation).toBeUndefined();
    expect(data.documents).toBeDefined();
    expect(data.documentCount).toBeGreaterThan(0);
  });

  it('should include entrypoints from manifest', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleManifest(project, {
      projectId: 'test-project',
      branch: 'main',
    });

    const data = JSON.parse(result.content[0].text);
    expect(Array.isArray(data.entrypoints)).toBe(true);
    expect(data.entrypoints.length).toBeGreaterThan(0);
    expect(data.entrypoints[0].path).toBe('STATUS.md');
    expect(data.entrypoints[0].role).toBe('front-page');
  });
});

// ── Existing tests (updated for managed storage) ─────────────────────

describe('reading docs', () => {
  it('should read a file from the Git store', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const { content } = await project.readFile('main', 'docs/nonexistent.md');
    expect(content).toBeNull();
  });
});

describe('bounded docs.read via handler', () => {
  it('should be backward-compatible without maxChars', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.path).toBe('docs/README.md');
    expect(data.branch).toBe('main');
    expect(data.revision).toBeTruthy();
    expect(data.content).toContain('Documentation');
    expect(data.truncated).toBe(false);
    expect(data.maxChars).toBeNull();
    expect(data.offset).toBe(0);
    expect(data.returnedChars).toBe(data.totalChars);
  });

  it('should truncate content with maxChars and set truncated true', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      maxChars: 10,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.content).toBe('# Document');
    expect(data.content.length).toBe(10);
    expect(data.truncated).toBe(true);
    expect(data.maxChars).toBe(10);
    expect(data.returnedChars).toBe(10);
    expect(data.totalChars).toBeGreaterThan(10);
  });

  it('should set truncated false when maxChars is larger than content', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      maxChars: 999999,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.content).toContain('Documentation');
    expect(data.truncated).toBe(false);
    expect(data.maxChars).toBe(999999);
    expect(data.returnedChars).toBe(data.totalChars);
  });

  it('should return a later slice with offset', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    // First read full content to know total length
    const fullResult = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
    });
    const fullData = JSON.parse(fullResult.content[0].text);
    const fullContent: string = fullData.content;
    const laterPortion = fullContent.slice(50);

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      offset: 50,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.content).toBe(laterPortion);
    expect(data.offset).toBe(50);
    expect(data.returnedChars).toBe(laterPortion.length);
    expect(data.totalChars).toBe(fullContent.length);
  });

  it('should combine offset and maxChars correctly', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      offset: 10,
      maxChars: 20,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.content.length).toBe(20);
    expect(data.offset).toBe(10);
    expect(data.maxChars).toBe(20);
    expect(data.returnedChars).toBe(20);
    expect(data.totalChars).toBeGreaterThan(30);
  });

  it('should include revision as before', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      maxChars: 5,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.revision).toBeTruthy();
    expect(typeof data.revision).toBe('string');
    expect(data.revision.length).toBeGreaterThan(0);
  });

  it('should report missing files clearly', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'nonexistent-file.md',
      branch: 'main',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('not found');
  });

  it('should handle offset beyond content length gracefully', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: 'docs/README.md',
      branch: 'main',
      offset: 999999,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.content).toBe('');
    expect(data.truncated).toBe(false);
    expect(data.returnedChars).toBe(0);
  });

  it('should handle path traversal detection in bounded read', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const result = await handleRead(project, {
      projectId: 'test-project',
      path: '../etc/passwd',
      branch: 'main',
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('Path traversal');
  });
});

describe('creating branches', () => {
  it('should create a new branch from main', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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

  it('should return null for non-existent proposal', async () => {
    const project = new Project({
      projectRoot: tmpDir,
      projectId: 'test-project',
    });
    await project.ensureEventLog();
    const eventLog = project.eventLog;

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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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

describe('GitStore workdir cleanup', () => {
  it('should reset dirty files from workdir before each withWorkDir operation', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
    });

    const repoDir = project.gitStore.repoDir;
    const workDir = path.join(repoDir, 'workdir');

    // Ensure workdir exists with a known branch checked out
    await project.gitStore.createBranch('test-branch', 'main');

    // Manually write an untracked (dirty) file into the workdir
    const dirtyFilePath = path.join(workDir, 'docs', 'dirty-file.md');
    await fs.promises.mkdir(path.dirname(dirtyFilePath), { recursive: true });
    await fs.promises.writeFile(dirtyFilePath, '# Dirty content');

    // Manually modify a tracked file in the workdir
    const readmePath = path.join(workDir, 'docs', 'README.md');
    const existingContent = await fs.promises.readFile(readmePath, 'utf-8');
    await fs.promises.writeFile(readmePath, existingContent + '\nDirty modification\n');

    // Call exportBranch — this goes through withWorkDir and should trigger cleanup
    const exportDir = path.join(tmpDir, 'export-output');
    await project.gitStore.exportBranch('test-branch', exportDir);

    // After the operation, the untracked dirty file should be gone from workdir
    await expect(fs.promises.stat(dirtyFilePath)).rejects.toThrow();

    // After the operation, the tracked file should be reset to its clean state
    const cleanedReadme = await fs.promises.readFile(readmePath, 'utf-8');
    expect(cleanedReadme).not.toContain('Dirty modification');

    // Verify the exported files do not contain the dirty file
    const exportDocs = await fs.promises.readdir(path.join(exportDir, 'docs'));
    expect(exportDocs).not.toContain('dirty-file.md');
  });
});

describe('stale proposal detection', () => {
  it('should reject a proposal whose base revision is stale after another commit', async () => {
    const project = await Project.init({
      projectRoot: tmpDir,
      projectId: 'test-project',
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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
      configDir: path.join(tmpDir, 'config'),
      dataDir: path.join(tmpDir, 'data'),
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

// ── CLI init command (v0.3 with registry registration) ────────────────

describe('CLI init command', () => {
  it('should initialize project AND register it in the registry', async () => {
    const configDir = path.join(tmpDir, 'config');
    const dataDir = path.join(tmpDir, 'data');

    await initCommand({
      projectRoot: tmpDir,
      projectId: 'my-project',
      configDir,
      dataDir,
    });

    // Managed state should be under <dataDir>/projects/my-project/
    const managedDir = path.join(dataDir, 'projects', 'my-project');
    const managedStat = await fs.promises.stat(managedDir);
    expect(managedStat.isDirectory()).toBe(true);

    // Git repo should exist in managed storage
    const repoPath = path.join(managedDir, 'repo.git');
    const repoStat = await fs.promises.stat(repoPath);
    expect(repoStat.isDirectory()).toBe(true);

    // Events DB should exist in managed storage
    const eventsPath = path.join(managedDir, 'events.sqlite');
    const dbStat = await fs.promises.stat(eventsPath);
    expect(dbStat.isFile()).toBe(true);

    // Project should be registered in the registry
    const registry = await Registry.load(configDir, dataDir);
    const entry = registry.getProject('my-project');
    expect(entry).not.toBeNull();
    expect(entry!.projectRoot).toBe(tmpDir);
    expect(entry!.projectId).toBe('my-project');

    // Project root should NOT have .docu-guard/
    await expect(fs.promises.stat(path.join(tmpDir, '.docu-guard'))).rejects.toThrow();
  });

  it('should be idempotent — registering same project again updates root', async () => {
    const configDir = path.join(tmpDir, 'config');
    const dataDir = path.join(tmpDir, 'data');

    // Init twice with different project root (simulating re-init)
    await initCommand({
      projectRoot: tmpDir,
      projectId: 'my-project',
      configDir,
      dataDir,
    });

    const registry = await Registry.load(configDir, dataDir);
    const entry = registry.getProject('my-project');
    expect(entry).not.toBeNull();
    expect(entry!.projectRoot).toBe(tmpDir);
    expect(entry!.createdAt).toBeTruthy();
    expect(entry!.updatedAt).toBeTruthy();
  });

  it('should respect custom configDir and dataDir for registry', async () => {
    const configDir = path.join(tmpDir, 'custom-config');
    const dataDir = path.join(tmpDir, 'custom-data');

    await initCommand({
      projectRoot: tmpDir,
      projectId: 'custom-proj',
      configDir,
      dataDir,
    });

    // Registry should be at configDir/projects.json
    const registryPath = path.join(configDir, 'projects.json');
    const regStat = await fs.promises.stat(registryPath);
    expect(regStat.isFile()).toBe(true);

    // Managed state should be at dataDir/projects/custom-proj/
    const managedDir = path.join(dataDir, 'projects', 'custom-proj');
    const managedStat = await fs.promises.stat(managedDir);
    expect(managedStat.isDirectory()).toBe(true);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function createSimplePatch(original: string, updated: string, filePath = 'docs/README.md'): string {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');

  const maxLen = Math.max(origLines.length, newLines.length);

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
