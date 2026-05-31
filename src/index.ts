#!/usr/bin/env node

import {
  initCommand,
  serverCommand,
  listCommand,
  historyCommand,
  exportCommand,
} from './cli/init.js';
import {
  parseProjectArgs,
  printProjectUsage,
  projectAddCommand,
  projectRemoveCommand,
  projectListCommand,
  projectShowCommand,
  projectDefaultCommand,
} from './cli/project.js';
import { daemonCommand } from './cli/daemon.js';

function printUsage(): void {
  console.log(`
docu-guard — Safe, versioned, auditable documentation management for AI-assisted projects

USAGE:
  docu-guard <command> [options]

COMMANDS:
  init       Initialize a docu-guard project
    --project-root <path>   Path to the project root (default: .)
    --project-id <id>       Unique identifier for the project

  server     Start the MCP server
    --project-root <path>   Path to the project root (default: .)
    --project-id <id>       Project identifier (optional, defaults to dir name)

  daemon     Start the daemon (HTTP MCP server)
    --host <host>           Host to bind to (default: 127.0.0.1)
    --port <port>           Port to listen on (default: 3737)
    --project-id <id>       Optional: register a project on startup
    --project-root <path>   Optional: project root (used with --project-id)

  project    Manage registered projects
    add --project-id <id> --project-root <path>
    remove --project-id <id>
    list
    show --project-id <id>
    default --project-id <id>

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
  docu-guard init --project-root . --project-id my-project
  docu-guard server --project-root .
  docu-guard daemon
  docu-guard project add --project-id my-app --project-root /path/to/my-app
  docu-guard project list
  docu-guard list
  docu-guard history docs/README.md
  docu-guard export --branch main
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
    } else if (arg === '--host' && i + 1 < process.argv.length) {
      args['host'] = process.argv[i + 1];
      i += 2;
    } else if (arg === '--port' && i + 1 < process.argv.length) {
      args['port'] = process.argv[i + 1];
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

    case 'daemon': {
      await daemonCommand({
        host: args['host'] || '127.0.0.1',
        port: parseInt(args['port'] || '3737', 10),
        projectId: args['project-id'],
        projectRoot: args['project-root'],
      });
      break;
    }

    case 'project': {
      const { subcommand, kwargs } = parseProjectArgs(process.argv);

      if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        printProjectUsage();
        process.exit(0);
      }

      switch (subcommand) {
        case 'add': {
          const pid = kwargs['project-id'];
          const proot = kwargs['project-root'];
          if (!pid || !proot) {
            console.error('Error: --project-id and --project-root are required for project add');
            process.exit(1);
          }
          await projectAddCommand(pid, proot);
          break;
        }
        case 'remove': {
          const pid = kwargs['project-id'];
          if (!pid) {
            console.error('Error: --project-id is required for project remove');
            process.exit(1);
          }
          await projectRemoveCommand(pid);
          break;
        }
        case 'list': {
          await projectListCommand();
          break;
        }
        case 'show': {
          const pid = kwargs['project-id'];
          if (!pid) {
            console.error('Error: --project-id is required for project show');
            process.exit(1);
          }
          await projectShowCommand(pid);
          break;
        }
        case 'default': {
          const pid = kwargs['project-id'];
          if (!pid) {
            console.error('Error: --project-id is required for project default');
            process.exit(1);
          }
          await projectDefaultCommand(pid);
          break;
        }
        default: {
          console.error(`Unknown project subcommand: "${subcommand}"`);
          printProjectUsage();
          process.exit(1);
        }
      }
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
        console.log('Usage: docu-guard history <path>');
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
