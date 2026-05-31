import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from '../core/project.js';
import { startMcpServer } from '../mcp/server.js';
import { mergeHistory, type GitHistoryEntry, type EventHistoryEntry } from '../mcp/tools.js';

export interface InitOptions {
  projectRoot: string;
  projectId: string;
}

/**
 * Run the `docs-mcp init` command.
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

  console.log(`Initializing docs-mcp in ${resolvedRoot}...`);

  const project = await Project.init({
    projectRoot: resolvedRoot,
    projectId: options.projectId,
  });

  console.log(`✓ Created .docs-mcp/ directory`);
  console.log(`✓ Initialized Git-backed docs store at .docs-mcp/repo.git`);
  console.log(`✓ Created event log at .docs-mcp/events.sqlite`);
  console.log(`✓ Created .docs-policy.yml`);
  console.log(`✓ Created docs/ directory structure`);
  console.log(`✓ Created/updated AGENTS.md with documentation safety rules`);
  console.log(`✓ Snapshotted initial documentation`);
  console.log(`\n✅ docs-mcp project "${options.projectId}" initialized successfully.\n`);
  console.log(`Next steps:`);
  console.log(`  1. Start the server:  docs-mcp server --project-root .`);
  console.log(`  2. Configure your MCP client to connect to the server`);
  console.log(`  3. Use docs.list, docs.read, and docs.propose_patch tools`);
}

/**
 * Run the `docs-mcp server` command.
 */
export async function serverCommand(options: InitOptions): Promise<void> {
  const resolvedRoot = path.resolve(options.projectRoot);

  // Verify initialization
  const docsMcpDir = path.join(resolvedRoot, '.docs-mcp');
  try {
    await fs.promises.access(docsMcpDir);
  } catch {
    console.error(
      `Error: "${resolvedRoot}" has not been initialized. Run "docs-mcp init" first.`,
    );
    process.exit(1);
  }

  // Load project config from .docs-mcp
  let projectId = options.projectId;
  if (!projectId) {
    // Try to read project ID from a config file or just use dirname
    projectId = path.basename(resolvedRoot);
  }

  console.error(`Starting docs-mcp server for project "${projectId}"...`);
  console.error(`Project root: ${resolvedRoot}`);

  await startMcpServer({
    projectRoot: resolvedRoot,
    projectId,
  });
}

/**
 * Run the `docs-mcp list` command.
 */
export async function listCommand(projectRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
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
 * Run the `docs-mcp history <path>` command.
 */
export async function historyCommand(
  projectRoot: string,
  filePath: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
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
 * Run the `docs-mcp export` command.
 */
export async function exportCommand(
  projectRoot: string,
  branch: string,
  targetDir?: string,
): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  await requireInit(resolvedRoot);

  const project = await Project.load({
    projectRoot: resolvedRoot,
    projectId: path.basename(resolvedRoot),
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

/**
 * Require that a project has been initialized. Exits with a clear message if not.
 */
async function requireInit(projectRoot: string): Promise<void> {
  const docsMcpDir = path.join(projectRoot, '.docs-mcp');
  try {
    await fs.promises.access(docsMcpDir);
  } catch {
    console.error(
      `Error: "${projectRoot}" has not been initialized. Run "docs-mcp init" first.`,
    );
    process.exit(1);
  }
}
