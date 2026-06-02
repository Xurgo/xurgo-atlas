import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from '../core/project.js';
import { Registry } from '../core/registry.js';
import { StoragePaths } from '../core/storage.js';
import { startMcpServer } from '../mcp/server.js';
import { mergeHistory, type GitHistoryEntry, type EventHistoryEntry } from '../mcp/tools.js';

export interface InitOptions {
  projectRoot: string;
  projectId: string;
  configDir?: string;
  dataDir?: string;
}

/**
 * Run the `docu-guard init` command.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const resolvedRoot = path.resolve(options.projectRoot);

  // Verify the project root exists
  try {
    const stat = await fs.promises.stat(resolvedRoot);
    if (!stat.isDirectory()) {
      console.error(`Error: "${resolvedRoot}" is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: "${resolvedRoot}" does not exist`);
    process.exit(1);
  }

  // Check for pre-v0.3 .docu-guard/ directory (warn, don't block)
  const legacyDir = path.join(resolvedRoot, '.docu-guard');
  try {
    const legacyStat = await fs.promises.stat(legacyDir);
    if (legacyStat.isDirectory()) {
      console.error(
        `Warning: Found pre-v0.3 .docu-guard/ directory at ${legacyDir}. ` +
          'This is a development artifact from an earlier version. ' +
          'To migrate, copy its contents to the managed store then remove it. ' +
          'The managed store will be created at the configured data directory.',
      );
    }
  } catch {
    // .docu-guard/ does not exist — fine
  }

  // Resolve storage paths for display
  const storage = new StoragePaths({
    configDir: options.configDir,
    dataDir: options.dataDir,
  });

  console.log(`Initializing docu-guard in ${resolvedRoot}...`);

  const project = await Project.init({
    projectRoot: resolvedRoot,
    projectId: options.projectId,
    configDir: options.configDir,
    dataDir: options.dataDir,
  });

  // Register the project in the global registry
  const registry = await Registry.load(options.configDir, options.dataDir);
  await registry.addProject(options.projectId, resolvedRoot);

  console.log(`✓ Initialized Git-backed docs store at ${storage.projectRepoPath(options.projectId)}`);
  console.log(`✓ Created event log at ${storage.projectEventsPath(options.projectId)}`);
  console.log(`✓ Created .docs-policy.yml`);
  console.log(`✓ Created STATUS.md`);
  console.log(`✓ Created docs/ directory structure with manifest.yml`);
  console.log(`✓ Created/updated AGENTS.md with documentation safety rules`);
  console.log(`✓ Snapshotted initial documentation`);
  console.log(`✓ Registered project in ${storage.registryPath()}`);
  console.log(`\n✅ docu-guard project "${options.projectId}" initialized successfully.\n`);

  console.log(`  1. Start the server:  docu-guard server --project-root .`);
  console.log(`  2. Configure your MCP client to connect to the server`);
  console.log(`  3. Use docs.list, docs.read, and docs.propose_patch tools`);
}

/**
 * Run the `docu-guard server` command.
 */
export async function serverCommand(options: InitOptions & { configDir?: string; dataDir?: string }): Promise<void> {
  const resolvedRoot = path.resolve(options.projectRoot);

  // Verify initialization by checking project files exist
  const hasPolicy = await fileExists(path.join(resolvedRoot, '.docs-policy.yml'));
  const hasDocs = await dirExists(path.join(resolvedRoot, 'docs'));
  if (!hasPolicy && !hasDocs) {
    console.error(
      `Error: "${resolvedRoot}" has not been initialized. Run "docu-guard init" first.`,
    );
    process.exit(1);
  }

  let projectId = options.projectId;
  if (!projectId) {
    projectId = path.basename(resolvedRoot);
  }

  console.error(`Starting docu-guard server for project "${projectId}"...`);
  console.error(`Project root: ${resolvedRoot}`);

  await startMcpServer({
    projectRoot: resolvedRoot,
    projectId,
    configDir: options.configDir,
    dataDir: options.dataDir,
  });
}

/**
 * Run the `docu-guard list` command.
 */
export async function listCommand(
  projectRoot: string,
  configDir?: string,
  dataDir?: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
    configDir,
    dataDir,
  });

  const filePaths = await project.getTrackedFiles();
  const branchRevision = await project.gitStore.getBranchHead('main');

  // Enrich each file with revision and protected status
  const files = await Promise.all(
    filePaths.map(async (filePath) => ({
      path: filePath,
      revision: await project.gitStore.getFileRevision('main', filePath),
      protected: project.policy.isPathProtected(filePath),
    })),
  );

  console.log(JSON.stringify({ projectId: path.basename(resolvedRoot), branch: 'main', revision: branchRevision, files }, null, 2));
}

/**
 * Run the `docu-guard history <path>` command.
 */
export async function historyCommand(
  projectRoot: string,
  filePath: string,
  configDir?: string,
  dataDir?: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
    configDir,
    dataDir,
  });

  const gitHistory = await project.gitStore.getHistory(filePath);
  const events = project.eventLog.getHistoryForPath(
    path.basename(resolvedRoot),
    filePath,
  );

  // Use the same unified merge as the MCP tool
  const history = mergeHistory(gitHistory as GitHistoryEntry[], events as EventHistoryEntry[]);

  console.log(JSON.stringify({ path: filePath, history }, null, 2));
}

/**
 * Run the `docu-guard export` command.
 */
export async function exportCommand(
  projectRoot: string,
  branch: string,
  configDir?: string,
  dataDir?: string,
  targetDir?: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
    configDir,
    dataDir,
  });

  const exportTarget = targetDir
    ? path.resolve(targetDir)
    : resolvedRoot;

  console.log(`Exporting branch "${branch}" to "${exportTarget}"...`);

  const exportedFiles = await project.gitStore.exportBranch(
    branch,
    exportTarget,
  );

  console.log(`Exported ${exportedFiles.length} files:`);
  for (const file of exportedFiles) {
    console.log(`  - ${file}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Require that a project has been initialized. Exits with a clear message if not.
 * Checks for project files (docs/, .docs-policy.yml) rather than .docu-guard/.
 */
async function requireInit(projectRoot: string): Promise<void> {
  const hasPolicy = await fileExists(path.join(projectRoot, '.docs-policy.yml'));
  const hasDocs = await dirExists(path.join(projectRoot, 'docs'));
  if (!hasPolicy && !hasDocs) {
    console.error(
      `Error: "${projectRoot}" has not been initialized. Run "docu-guard init" first.`,
    );
    process.exit(1);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
