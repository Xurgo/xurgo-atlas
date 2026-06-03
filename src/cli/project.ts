import * as path from 'node:path';
import { Registry } from '../core/registry.js';

/**
 * Parse command-line args for `xurgo-atlas project <subcommand> [options]`.
 * Returns { subcommand, kwargs }.
 */
export function parseProjectArgs(argv: string[]): {
  subcommand: string;
  kwargs: Record<string, string>;
} {
  const subcommand = argv[3] || '';
  const kwargs: Record<string, string> = {};

  for (let i = 4; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-id' && i + 1 < argv.length) {
      kwargs['project-id'] = argv[++i];
    } else if (arg === '--project-root' && i + 1 < argv.length) {
      kwargs['project-root'] = argv[++i];
    } else if (arg === '--config-dir' && i + 1 < argv.length) {
      kwargs['config-dir'] = argv[++i];
    } else if (arg.startsWith('--')) {
      // Skip unknown flags
    }
  }

  return { subcommand, kwargs };
}

/**
 * Print usage for `xurgo-atlas project` subcommands.
 */
export function getProjectUsageText(): string {
  return `
Manage registered Xurgo Atlas projects.
Legacy alias: docu-guard (temporary)

USAGE:
  xurgo-atlas project <subcommand> [options]

SUBCOMMANDS:
  add       Register a new project
    --project-id <id>     Unique identifier for the project
    --project-root <path> Path to the project root
    --config-dir <path>   Config directory (default: ~/.config/xurgo-atlas; legacy docu-guard roots auto-discovered)

  remove    Remove a project from the registry
    --project-id <id>     Project identifier

  list      List all registered projects

  show      Show details for a registered project
    --project-id <id>     Project identifier

  default   Set the default project (used when projectId is omitted)
    --project-id <id>     Project identifier

EXAMPLES:
  xurgo-atlas project add --project-id my-app --project-root /path/to/my-app
  xurgo-atlas project remove --project-id my-app
  xurgo-atlas project list
  xurgo-atlas project show --project-id my-app
  xurgo-atlas project default --project-id my-app

Legacy compatibility alias remains: docu-guard project <subcommand>
`;
}

export function printProjectUsage(): void {
  console.log(getProjectUsageText());
}

// ── Subcommand handlers ────────────────────────────────────────────────

export async function projectAddCommand(projectId: string, projectRoot: string, configDir?: string): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  const registry = await Registry.load(configDir);
  const entry = await registry.addProject(projectId, resolvedRoot);
  console.log(`✅ Project "${projectId}" registered at ${resolvedRoot}`);
  console.log(`   Created: ${entry.createdAt}`);
}

export async function projectRemoveCommand(projectId: string, configDir?: string): Promise<void> {
  const registry = await Registry.load(configDir);
  const removed = await registry.removeProject(projectId);
  if (removed) {
    console.log(`✅ Project "${projectId}" removed from registry.`);
  } else {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
}

export async function projectListCommand(configDir?: string): Promise<void> {
  const registry = await Registry.load(configDir);
  const projects = registry.listProjects();
  const defaultEntry = registry.getDefault();

  if (projects.length === 0) {
    console.log('No projects registered.');
    console.log('Use "xurgo-atlas project add --project-id <id> --project-root <path>" to add one.');
    return;
  }

  console.log('Registered projects:');
  for (const p of projects) {
    const isDefault = defaultEntry && p.projectId === defaultEntry.projectId;
    console.log(`  ${isDefault ? '*' : ' '} ${p.projectId} -> ${p.projectRoot}${isDefault ? ' (default)' : ''}`);
  }
}

export async function projectShowCommand(projectId: string, configDir?: string): Promise<void> {
  const registry = await Registry.load(configDir);
  const entry = registry.getProject(projectId);
  if (!entry) {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
  console.log(JSON.stringify(entry, null, 2));
}

export async function projectDefaultCommand(projectId: string, configDir?: string): Promise<void> {
  const registry = await Registry.load(configDir);
  try {
    await registry.setDefault(projectId);
    console.log(`✅ Default project set to "${projectId}".`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}
