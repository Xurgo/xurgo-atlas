#!/usr/bin/env node

import {
  initCommand,
  serverCommand,
  listCommand,
  historyCommand,
  exportCommand,
} from './cli/init.js';

function printUsage(): void {
  console.log(`
docs-mcp — Safe, versioned, auditable documentation management for AI-assisted projects

USAGE:
  docs-mcp <command> [options]

COMMANDS:
  init       Initialize a docs-mcp project
    --project-root <path>   Path to the project root (default: .)
    --project-id <id>       Unique identifier for the project

  server     Start the MCP server
    --project-root <path>   Path to the project root (default: .)
    --project-id <id>       Project identifier (optional, defaults to dir name)

  list       List tracked documentation files
    --project-root <path>   Path to the project root (default: .)

  history <path>
             View the history of a documentation file
    --project-root <path>   Path to the project root (default: .)

  export     Export documentation from a branch to the project root
    --branch <name>         Branch to export (default: main)
    --target-dir <path>     Target directory (default: project root)
    --project-root <path>   Path to the project root (default: .)

EXAMPLES:
  docs-mcp init --project-root . --project-id my-project
  docs-mcp server --project-root .
  docs-mcp list
  docs-mcp history docs/README.md
  docs-mcp export --branch main
`);
}

function parseArgv(): Record<string, string> {
  const args: Record<string, string> = {};
  let i = 2; // skip "node" and "script"
  // If running via the CLI binary, args start at index 2 as well
  // but if it's "node dist/index.js", process.argv[1] is the script path
  // We handle both cases

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === '--project-root' && i + 1 < process.argv.length) {
      args['project-root'] = process.argv[i + 1];
      i += 2;
    } else if (arg === '--project-id' && i + 1 < process.argv.length) {
      args['project-id'] = process.argv[i + 1];
      i += 2;
    } else if (arg === '--branch' && i + 1 < process.argv.length) {
      args['branch'] = process.argv[i + 1];
      i += 2;
    } else if (arg === '--target-dir' && i + 1 < process.argv.length) {
      args['target-dir'] = process.argv[i + 1];
      i += 2;
    } else if (arg.startsWith('--')) {
      // Unknown flag, skip
      i++;
    } else {
      // Non-flag argument
      args['_default'] = arg;
      i++;
    }
  }

  return args;
}

async function main(): Promise<void> {
  // Parse the command
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const args = parseArgv();
  const projectRoot = args['project-root'] || process.cwd();
  const projectId = args['project-id'] || '';
  const branch = args['branch'] || 'main';
  const targetDir = args['target-dir'];

  switch (command) {
    case 'init': {
      if (!projectId) {
        console.error('Error: --project-id is required for init');
        process.exit(1);
      }
      await initCommand({ projectRoot, projectId });
      break;
    }

    case 'server': {
      await serverCommand({
        projectRoot,
        projectId: projectId || requireProjectId(projectRoot),
      });
      break;
    }

    case 'list': {
      await listCommand(projectRoot);
      break;
    }

    case 'history': {
      const filePath = args['_default'];
      if (!filePath) {
        console.error('Error: path argument is required for history');
        console.log('Usage: docs-mcp history <path>');
        process.exit(1);
      }
      await historyCommand(projectRoot, filePath);
      break;
    }

    case 'export': {
      await exportCommand(projectRoot, branch, targetDir);
      break;
    }

    default: {
      console.error(`Unknown command: "${command}"`);
      printUsage();
      process.exit(1);
    }
  }
}

function requireProjectId(projectRoot: string): string {
  // Try to read the project name from the current directory
  const parts = projectRoot.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'unnamed-project';
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
