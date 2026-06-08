import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from '../core/project.js';
import { Registry } from '../core/registry.js';
import { StoragePaths } from '../core/storage.js';
import {
  getTemplate,
  getTemplateListText,
  isValidTemplate,
  TEMPLATE_NAMES,
  buildManifestYaml,
  type TemplateFile,
} from '../core/templates.js';
import { startMcpServer } from '../mcp/server.js';
import { mergeHistory, type GitHistoryEntry, type EventHistoryEntry } from '../mcp/tools.js';

export interface InitOptions {
  projectRoot: string;
  projectId: string;
  configDir?: string;
  dataDir?: string;
  template?: string;
}

export function getInitUsageText(): string {
  return `
Initialize a Xurgo Atlas project

USAGE:
  xurgo-atlas init [options]

OPTIONS:
  --project-root <path>   Path to the project root (default: .)
  --project-id <id>       Unique identifier for the project
  --config-dir <path>     Config directory (default: ~/.config/xurgo-atlas; overrides XURGO_ATLAS_CONFIG_DIR; legacy roots auto-discovered)
  --data-dir <path>       Data directory (default: ~/.local/share/xurgo-atlas; overrides XURGO_ATLAS_DATA_DIR; legacy roots auto-discovered)
  --template <name>       Documentation template to use (default: "default")
  -t <name>               Short form of --template
  --templates             List available templates and exit

AVAILABLE TEMPLATES:
  default      Generic project with standard Atlas docs and project brief
  saas         SaaS product with product brief, MVP scope, and development workflow
  cli-tool     CLI tool with command surface docs, packaging notes, and validation workflow
  mcp-server   MCP server with tool/resource surface, daemon setup, and safety boundaries
  web-app      Web application with product brief, route structure, and frontend architecture

EXAMPLES:
  xurgo-atlas init --project-root . --project-id my-project
  xurgo-atlas init --template saas --project-id clientpulse
  xurgo-atlas init -t cli-tool --project-id my-cli
  xurgo-atlas init --templates
`;
}

export function printInitUsage(): void {
  console.log(getInitUsageText());
}

/**
 * Run the `xurgo-atlas init` command.
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
          'Clean up this old project-local artifact manually; it is not used as active storage. ' +
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

  // Resolve template
  const isExplicitTemplate = options.template !== undefined;
  const templateName = options.template || 'default';
  if (!isValidTemplate(templateName)) {
    console.error(`Error: unknown template "${templateName}".`);
    console.error('');
    console.error(getTemplateListText());
    process.exit(1);
  }
  const templateDef = getTemplate(templateName)!;

  // Check which documentation files already exist before init
  const existed: Record<string, boolean> = {
    policy: await fileExists(path.join(resolvedRoot, '.docs-policy.yml')),
    status: await fileExists(path.join(resolvedRoot, 'STATUS.md')),
    agents: await fileExists(path.join(resolvedRoot, 'AGENTS.md')),
    manifest: await fileExists(path.join(resolvedRoot, 'docs', 'manifest.yml')),
  };

  console.log(`Initializing Xurgo Atlas in ${resolvedRoot}...`);

  // Only create template-specific files when the user explicitly
  // specified a --template flag. Plain init never creates template
  // docs, even on new/empty projects — only the standard foundation
  // files (.docs-policy.yml, STATUS.md, AGENTS.md, docs/manifest.yml).
  const shouldCreateTemplateDocs = isExplicitTemplate;

  // Check existence of template-specific files
  const templateFileStatus: { path: string; existed: boolean }[] = [];
  if (shouldCreateTemplateDocs) {
    for (const tf of templateDef.files) {
      const fullPath = path.join(resolvedRoot, tf.path);
      const fileExisted = await fileExists(fullPath);
      templateFileStatus.push({ path: tf.path, existed: fileExisted });
      if (!fileExisted) {
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, tf.content, 'utf-8');
      }
    }
  }

  // If manifest does not exist, create it now with template-specific entries
  // (or standard-only entries for plain init)
  if (!existed.manifest) {
    const manifestPath = path.join(resolvedRoot, 'docs', 'manifest.yml');
    const manifestFiles = shouldCreateTemplateDocs ? templateDef.files : [];
    const manifestContent = buildManifestYaml(manifestFiles);
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(manifestPath, manifestContent, 'utf-8');
  }

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
  console.log(`✓ ${existed.policy ? 'Preserved existing' : 'Created'} .docs-policy.yml`);
  console.log(`✓ ${existed.status ? 'Preserved existing' : 'Created'} STATUS.md`);
  console.log(`✓ ${existed.manifest ? 'Preserved existing' : 'Created'} docs/manifest.yml`);
  console.log(`✓ ${existed.agents ? 'Preserved existing' : 'Created'} AGENTS.md`);

  // Report template-specific files
  for (const tfs of templateFileStatus) {
    console.log(`✓ ${tfs.existed ? 'Preserved existing' : 'Created'} ${tfs.path}`);
  }

  console.log(`✓ Snapshotted initial documentation`);
  console.log(`✓ Registered project in ${storage.registryPath()}`);
  if (templateName !== 'default') {
    console.log(`✓ Template: ${templateName}`);
  }
  console.log(`\n✅ Xurgo Atlas project "${options.projectId}" initialized successfully.\n`);

  // Build optional storage flags for follow-up commands
  const storageFlags = [
    options.configDir ? `--config-dir ${options.configDir}` : '',
    options.dataDir ? `--data-dir ${options.dataDir}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const suffix = storageFlags ? ` ${storageFlags}` : '';

  console.log(`  Next steps:`);
  console.log(`  xurgo-atlas daemon start${suffix}`);
  console.log(`  MCP endpoint: http://127.0.0.1:3737/mcp`);
  console.log(`  MCP config snippet: xurgo-atlas mcp-config`);
  console.log(`  xurgo-atlas daemon status${suffix}`);
  console.log(`  xurgo-atlas project list${suffix}`);

  // Let users know when env vars are active without explicit CLI flags
  if (!options.configDir && !options.dataDir) {
    const envParts: string[] = [];
    if (process.env.XURGO_ATLAS_CONFIG_DIR) envParts.push('XURGO_ATLAS_CONFIG_DIR');
    if (process.env.XURGO_ATLAS_DATA_DIR) envParts.push('XURGO_ATLAS_DATA_DIR');
    if (envParts.length > 0) {
      console.log(`  ${envParts.join(' and ')} from environment.`);
    }
  }
}

/**
 * Print available templates and exit.
 */
export function printTemplateList(): void {
  console.log(getTemplateListText());
}

/**
 * Run the `xurgo-atlas server` command.
 */
export async function serverCommand(options: InitOptions & { configDir?: string; dataDir?: string }): Promise<void> {
  const resolvedRoot = path.resolve(options.projectRoot);

  // Verify initialization by checking project files exist
  const hasPolicy = await fileExists(path.join(resolvedRoot, '.docs-policy.yml'));
  const hasDocs = await dirExists(path.join(resolvedRoot, 'docs'));
  if (!hasPolicy && !hasDocs) {
    console.error(
      `Error: "${resolvedRoot}" has not been initialized. Run "xurgo-atlas init" first.`,
    );
    process.exit(1);
  }

  let projectId = options.projectId;
  if (!projectId) {
    projectId = path.basename(resolvedRoot);
  }

  console.error(`Starting Xurgo Atlas server for project "${projectId}"...`);
  console.error(`Project root: ${resolvedRoot}`);

  await startMcpServer({
    projectRoot: resolvedRoot,
    projectId,
    configDir: options.configDir,
    dataDir: options.dataDir,
  });
}

/**
 * Run the `xurgo-atlas list` command.
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

  const filePaths = await project.getOwnedFiles();
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
 * Run the `xurgo-atlas history <path>` command.
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
 * Run the `xurgo-atlas export` command.
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

  // Export only current owned/tracked docs to prevent stale or
  // unmanifested files from leaking into the working tree.
  const ownedFiles = await project.getOwnedFiles(branch);

  const exportedFiles = await project.gitStore.exportBranch(
    branch,
    exportTarget,
    ownedFiles,
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
      `Error: "${projectRoot}" has not been initialized. Run "xurgo-atlas init" first.`,
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
