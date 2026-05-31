import * as path from 'node:path';
import { Registry } from '../core/registry.js';

/**
 * Parse command-line args for `docu-guard project <subcommand> [options]`.
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
    } else if (arg.startsWith('--')) {
      // Skip unknown flags
    }
  }

  return { subcommand, kwargs };
}

/**
 * Print usage for `docu-guard project` subcommands.
 */
export function printProjectUsage(): void {
  console.log(`
Manage registered docu-guard projects.

USAGE:
  docu-guard project <subcommand> [options]

SUBCOMMANDS:
  add       Register a new project
    --project-id <id>     Unique identifier for the project
    --project-root <path> Path to the project root

  remove    Remove a project from the registry
    --project-id <id>     Project identifier

  list      List all registered projects

  show      Show details for a registered project
    --project-id <id>     Project identifier

  default   Set the default project (used when projectId is omitted)
    --project-id <id>     Project identifier

EXAMPLES:
  docu-guard project add --project-id my-app --project-root /path/to/my-app
  docu-guard project remove --project-id my-app
  docu-guard project list
  docu-guard project show --project-id my-app
  docu-guard project default --project-id my-app
`);
}

// ── Subcommand handlers ────────────────────────────────────────────────

export async function projectAddCommand(projectId: string, projectRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  const registry = await Registry.load();
  const entry = await registry.addProject(projectId, resolvedRoot);
  console.log(`✅ Project "${projectId}" registered at ${resolvedRoot}`);
  console.log(`   Created: ${entry.createdAt}`);
}

export async function projectRemoveCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  const removed = await registry.removeProject(projectId);
  if (removed) {
    console.log(`✅ Project "${projectId}" removed from registry.`);
  } else {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
}

export async function projectListCommand(): Promise<void> {
  const registry = await Registry.load();
  const projects = registry.listProjects();
  const defaultEntry = registry.getDefault();

  if (projects.length === 0) {
    console.log('No projects registered.');
    console.log('Use "docu-guard project add --project-id <id> --project-root <path>" to add one.');
    return;
  }

  console.log('Registered projects:');
  for (const p of projects) {
    const isDefault = defaultEntry && p.projectId === defaultEntry.projectId;
    console.log(`  ${isDefault ? '*' : ' '} ${p.projectId} -> ${p.projectRoot}${isDefault ? ' (default)' : ''}`);
  }
}

export async function projectShowCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  const entry = registry.getProject(projectId);
  if (!entry) {
    console.error(`❌ Project "${projectId}" not found in registry.`);
    process.exit(1);
  }
  console.log(JSON.stringify(entry, null, 2));
}

export async function projectDefaultCommand(projectId: string): Promise<void> {
  const registry = await Registry.load();
  try {
    await registry.setDefault(projectId);
    console.log(`✅ Default project set to "${projectId}".`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}
