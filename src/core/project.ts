import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitStore, FileEntry } from './git-store.js';
import { Policy } from './policy.js';
import { EventLog } from './events.js';
import { StoragePaths } from './storage.js';

const AGENTS_MD_SAFETY_RULES = `# Agent Instructions for docu-guard-mcp

## Documentation Safety Rules

This project uses **docu-guard-mcp** for safe, versioned, auditable documentation management.

### Rules for AI Agents

1. **Never directly overwrite documentation files.** All documentation changes must go through the docu-guard-mcp MCP server.

2. **Read before you write.** Always read the current version of a document before proposing changes.

3. **Use docs.propose_patch to suggest changes.** Every change requires a patch with:
   - \`baseRevision\` - the revision hash returned when you read the file
   - \`intent\` - why you are making the change
   - \`summary\` - a brief description of the change
   - \`patch\` - the unified diff of your changes

4. **Use docs.commit_patch to finalize.** After proposing a patch, use \`docs.commit_patch\` to apply it. The server will re-validate the base revision before committing.

5. **Create branches for complex changes.** Use \`docs.create_branch\` to create feature branches for multi-step edits.

6. **Check risk assessments.** If a patch is marked high-risk, review the warnings before committing.

7. **Never delete content silently.** All deletions must be explicit in the patch diff.

### Tracked Files

The following files and directories are managed through docu-guard-mcp and must not be edited directly:

- \`AGENTS.md\`
- \`docs/**\`
- \`.docs-policy.yml\`

### Quick Reference

| Action | Tool |
|--------|------|
| List documentation | \`docs.list\` |
| Read a document | \`docs.read\` |
| Create a branch | \`docs.create_branch\` |
| Propose changes | \`docs.propose_patch\` |
| Preview changes | \`docs.preview_diff\` |
| Commit changes | \`docs.commit_patch\` |
| View history | \`docs.history\` |
| Restore a file | \`docs.restore_file\` |
| Export documentation | \`docs.export\` |
`;

export interface ProjectConfig {
  projectRoot: string;
  projectId: string;
  configDir?: string;
  dataDir?: string;
}

export class Project {
  public readonly root: string;
  public readonly projectId: string;
  public readonly gitStore: GitStore;
  private _eventLog: EventLog | null = null;
  public policy: Policy;
  private _ensureDataDir: Promise<unknown>;
  private _storage: StoragePaths;

  constructor(config: ProjectConfig) {
    this.root = config.projectRoot;
    this.projectId = config.projectId;
    this._storage = new StoragePaths({
      configDir: config.configDir,
      dataDir: config.dataDir,
    });
    const repoPath = this._storage.projectRepoPath(this.projectId);
    this.gitStore = new GitStore(repoPath);
    this.policy = new Policy();
    // Ensure the managed data directory exists
    this._ensureDataDir = fs.promises.mkdir(
      this._storage.projectDataDir(this.projectId),
      { recursive: true },
    );
  }

  /** Convenient access to the storage paths used by this project. */
  get storage(): StoragePaths {
    return this._storage;
  }

  get eventLog(): EventLog {
    if (!this._eventLog) {
      throw new Error(
        'EventLog not initialized. Call await project.ensureEventLog() first.',
      );
    }
    return this._eventLog;
  }

  async ensureEventLog(): Promise<EventLog> {
    if (!this._eventLog) {
      await this._ensureDataDir;
      this._eventLog = new EventLog(
        this._storage.projectEventsPath(this.projectId),
      );
    }
    return this._eventLog;
  }

  static async load(config: ProjectConfig): Promise<Project> {
    const project = new Project(config);
    project.policy = await Policy.load(config.projectRoot);
    await project.ensureEventLog();
    return project;
  }

  static async init(config: ProjectConfig): Promise<Project> {
    const project = new Project(config);

    // Warn if pre-v0.3 .docu-guard/ directory exists
    const legacyDir = path.join(project.root, '.docu-guard');
    try {
      const legacyStat = await fs.promises.stat(legacyDir);
      if (legacyStat.isDirectory()) {
        console.error(
          `Warning: Found pre-v0.3 .docu-guard/ directory at ${legacyDir}. ` +
            'This is a development artifact from an earlier version. ' +
            'Run migration or remove it manually. ' +
            'The managed store will be created at the configured data directory instead.',
        );
      }
    } catch {
      // .docu-guard/ does not exist — good
    }

    // Managed data directory is created in the constructor via _ensureDataDir

    // Initialize the Git-backed docs store
    await project.gitStore.init();

    // Initialize event log
    await project.ensureEventLog();

    // Create .docs-policy.yml if missing
    const policyPath = path.join(project.root, '.docs-policy.yml');
    let policyExists = false;
    try {
      await fs.promises.access(policyPath);
      policyExists = true;
    } catch { /* file does not exist */ }

    if (!policyExists) {
      project.policy = await Policy.createDefault(project.root);
    } else {
      project.policy = await Policy.load(project.root);
    }

    // Create default docs structure
    await ensureDocsStructure(project.root);

    // Create or update AGENTS.md
    await ensureAgentsMd(project.root);

    // Snapshot initial docs into the Git store
    const files = await collectTrackedFiles(project.root);
    await project.gitStore.snapshotInitial(files);

    // Log initialization event
    project.eventLog.logEvent({
      project_id: project.projectId,
      branch: 'main',
      path: '.docu-guard/init',
      tool_name: 'init',
      intent: 'Project initialization',
      summary: `Initialized docu-guard project "${project.projectId}" at ${project.root}`,
      result_revision: 'main',
    });

    return project;
  }

  async getTrackedFiles(branch = 'main'): Promise<string[]> {
    return this.gitStore.listFiles(branch);
  }

  async readFile(branch: string, filePath: string): Promise<{
    content: string | null;
    revision: string | null;
  }> {
    const content = await this.gitStore.readFile(branch, filePath);
    const revision = await this.gitStore.getFileRevision(branch, filePath);
    return { content, revision };
  }
}

async function ensureDocsStructure(projectRoot: string): Promise<void> {
  const docsDir = path.join(projectRoot, 'docs');
  await fs.promises.mkdir(docsDir, { recursive: true });

  const docsFiles: [string, string][] = [
    ['README.md', '# Documentation\n\nThis directory contains project documentation managed by docu-guard-mcp.\n'],
    ['spec/README.md', '# Specification\n\nThis directory contains project specifications.\n'],
  ];

  for (const [filePath, content] of docsFiles) {
    const fullPath = path.join(docsDir, filePath);
    try {
      await fs.promises.access(fullPath);
    } catch {
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content, 'utf-8');
    }
  }

  // Create implementation-checklist.md
  const checklistPath = path.join(docsDir, 'implementation-checklist.md');
  try {
    await fs.promises.access(checklistPath);
  } catch {
    const checklistContent = `# Implementation Checklist

## Overview

<!-- Add your implementation checklist items here -->

## Checklist

- [ ] Project initialized
- [ ] Documentation structure created
- [ ] First implementation task
`;
    await fs.promises.writeFile(checklistPath, checklistContent, 'utf-8');
  }
}

async function ensureAgentsMd(projectRoot: string): Promise<void> {
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  try {
    const existing = await fs.promises.readFile(agentsPath, 'utf-8');
    // Append safety rules if not present
    if (!existing.includes('docu-guard')) {
      await fs.promises.writeFile(
        agentsPath,
        existing + '\n\n' + AGENTS_MD_SAFETY_RULES,
        'utf-8',
      );
    }
  } catch {
    // File doesn't exist, create it
    await fs.promises.writeFile(agentsPath, AGENTS_MD_SAFETY_RULES, 'utf-8');
  }
}

async function collectTrackedFiles(projectRoot: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const patterns = [
    'AGENTS.md',
    'docs/**',
    '.docs-policy.yml',
  ];

  for (const pattern of patterns) {
    if (pattern === 'AGENTS.md') {
      const fullPath = path.join(projectRoot, 'AGENTS.md');
      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        files.push({ path: 'AGENTS.md', content });
      } catch { /* skip */ }
    } else if (pattern === '.docs-policy.yml') {
      const fullPath = path.join(projectRoot, '.docs-policy.yml');
      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        files.push({ path: '.docs-policy.yml', content });
      } catch { /* skip */ }
    } else if (pattern === 'docs/**') {
      await collectDirFiles(projectRoot, 'docs', projectRoot, files);
    }
  }

  return files;
}

async function collectDirFiles(
  projectRoot: string,
  dirPath: string,
  baseDir: string,
  files: FileEntry[],
): Promise<void> {
  const fullDir = path.join(projectRoot, dirPath);
  try {
    const entries = await fs.promises.readdir(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await collectDirFiles(projectRoot, entryPath, baseDir, files);
      } else if (entry.isFile()) {
        const fullPath = path.join(projectRoot, entryPath);
        try {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          files.push({ path: entryPath, content });
        } catch { /* skip */ }
      }
    }
  } catch { /* directory might not exist */ }
}
