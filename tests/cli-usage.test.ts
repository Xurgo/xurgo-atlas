import { afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUsageText, main } from '../src/index.js';
import { getDaemonUsageText } from '../src/cli/daemon.js';
import * as daemonCli from '../src/cli/daemon.js';
import * as initCli from '../src/cli/init.js';
import { Project } from '../src/core/project.js';
import { Registry } from '../src/core/registry.js';
import { getProjectUsageText, parseProjectArgs, printProjectUsage } from '../src/cli/project.js';
import {
  getStorageMigrationNotImplementedMessage,
  getStorageUsageText,
  storageInspectCommand,
  storageMigrateCommand,
} from '../src/cli/storage.js';
import * as storageCli from '../src/cli/storage.js';
import * as storageCore from '../src/core/storage.js';
import * as statusCli from '../src/cli/status.js';
import { getStatusUsageText, statusCommand } from '../src/cli/status.js';
import * as mcpConfigCli from '../src/cli/mcp-config.js';
import { getMcpConfigUsageText, mcpConfigCommand } from '../src/cli/mcp-config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

async function withXdgRoots<T>(
  run: (roots: { root: string; configHome: string; dataHome: string }) => Promise<T>,
): Promise<T> {
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const prevDataHome = process.env.XDG_DATA_HOME;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-cli-xdg-'));
  const configHome = path.join(root, 'config-home');
  const dataHome = path.join(root, 'data-home');

  process.env.XDG_CONFIG_HOME = configHome;
  process.env.XDG_DATA_HOME = dataHome;

  try {
    return await run({ root, configHome, dataHome });
  } finally {
    if (prevConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = prevConfigHome;
    }

    if (prevDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = prevDataHome;
    }

    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function writeProjectStore(dataDir: string, projectId: string): Promise<void> {
  const projectDir = path.join(dataDir, 'projects', projectId);
  await fs.promises.mkdir(path.join(projectDir, 'repo.git'), { recursive: true });
  await fs.promises.writeFile(
    path.join(projectDir, 'events.sqlite'),
    'sqlite-placeholder',
    'utf-8',
  );
}

async function runMainWithArgs(argv: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const originalArgv = process.argv;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const exitError = new Error('process.exit');
  let exitCode = -1;

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdoutLines.push(args.join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderrLines.push(args.join(' '));
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw exitError;
  }) as never);

  process.argv = argv;

  try {
    await main();
  } catch (error) {
    if (error !== exitError) {
      throw error;
    }
  } finally {
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    exitCode,
    stdout: stdoutLines.join('\n'),
    stderr: stderrLines.join('\n'),
  };
}

describe('CLI usage text', () => {
  it('shows atlas defaults and legacy discovery in the main help text', () => {
    const output = getUsageText();

    expect(output).toContain('xurgo-atlas — Xurgo Atlas');
    expect(output).toContain('storage    Inspect Atlas-vs-legacy managed storage (read-only)');
    expect(output).toContain('default: ~/.config/xurgo-atlas; overrides XURGO_ATLAS_CONFIG_DIR; legacy roots auto-discovered');
    expect(output).toContain('default: ~/.local/share/xurgo-atlas; overrides XURGO_ATLAS_DATA_DIR; legacy roots auto-discovered');
  });

  it('shows dedicated daemon help text without requiring foreground startup', () => {
    const output = getDaemonUsageText();

    expect(output).toContain('Manage the Xurgo Atlas daemon');
    expect(output).toContain('xurgo-atlas daemon [options]');
    expect(output).toContain('xurgo-atlas daemon start [options]');
    expect(output).toContain('[no subcommand]        Start the daemon in foreground mode');
  });

  it('lists status in the main help text', () => {
    const output = getUsageText();

    expect(output).toContain('status     Show the current setup status (read-only)');
    expect(output).toContain('xurgo-atlas status');
  });

  it('lists mcp-config in the main help text', () => {
    const output = getUsageText();

    expect(output).toContain('mcp-config Print MCP client connection guidance (read-only)');
    expect(output).toContain('xurgo-atlas mcp-config');
  });

  it('shows dedicated status help text', () => {
    const output = getStatusUsageText();

    expect(output).toContain('Show the current Xurgo Atlas setup status');
    expect(output).toContain('xurgo-atlas status [options]');
    expect(output).toContain('read-only');
    expect(output).toContain('--config-dir');
    expect(output).toContain('--data-dir');
  });

  it.each([
    ['--help without --project-id', ['node', 'xurgo-atlas', 'init', '--help']],
    ['-h without --project-id', ['node', 'xurgo-atlas', 'init', '-h']],
  ])('prints init help safely for %s', async (_label, argv) => {
    const initSpy = vi.spyOn(initCli, 'initCommand').mockResolvedValue(undefined);
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    await withXdgRoots(async ({ configHome, dataHome }) => {
      const result = await runMainWithArgs(argv);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas init [options]');
      expect(result.stdout).toContain('Initialize a Xurgo Atlas project');
      expect(result.stderr).toBe('');
      expect(initSpy).not.toHaveBeenCalled();
      expect(storageSpy).not.toHaveBeenCalled();
      await expect(fs.promises.stat(configHome)).rejects.toThrow();
      await expect(fs.promises.stat(dataHome)).rejects.toThrow();
    });
  });

  it.each([
    [
      '--project-id before --help',
      ['node', 'xurgo-atlas', 'init', '--project-id', 'foo', '--help'],
    ],
    [
      '--help before --project-id',
      ['node', 'xurgo-atlas', 'init', '--help', '--project-id', 'foo'],
    ],
  ])('prints init help safely for %s', async (_label, baseArgv) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-init-help-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const initSpy = vi.spyOn(initCli, 'initCommand').mockResolvedValue(undefined);
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    try {
      const result = await runMainWithArgs([
        ...baseArgv,
        '--config-dir',
        configDir,
        '--data-dir',
        dataDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas init [options]');
      expect(result.stdout).toContain('Initialize a Xurgo Atlas project');
      expect(result.stderr).toBe('');
      expect(initSpy).not.toHaveBeenCalled();
      expect(storageSpy).not.toHaveBeenCalled();
      await expect(fs.promises.stat(configDir)).rejects.toThrow();
      await expect(fs.promises.stat(dataDir)).rejects.toThrow();
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('still errors clearly when init is missing --project-id and help was not requested', async () => {
    const initSpy = vi.spyOn(initCli, 'initCommand').mockResolvedValue(undefined);
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: --project-id is required for init');
    expect(initSpy).not.toHaveBeenCalled();
    expect(storageSpy).toHaveBeenCalledTimes(1);
  });

  it('presents Xurgo Atlas as the primary project command name', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printProjectUsage();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Manage registered Xurgo Atlas projects.');
      expect(output).toContain('xurgo-atlas project <subcommand> [options]');
      expect(output).toContain('default: ~/.config/xurgo-atlas; overrides XURGO_ATLAS_CONFIG_DIR; legacy roots auto-discovered');
      expect(output).toContain('default: ~/.local/share/xurgo-atlas; overrides XURGO_ATLAS_DATA_DIR; legacy roots auto-discovered');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('shows legacy root discovery in project help text', () => {
    const output = getProjectUsageText();

    expect(output).toContain('Manage registered Xurgo Atlas projects.');
    expect(output).toContain('legacy roots auto-discovered');
  });

  it('parses config-dir and data-dir for project subcommands', () => {
    const parsed = parseProjectArgs([
      'node',
      'xurgo-atlas',
      'project',
      'list',
      '--config-dir',
      '/tmp/config',
      '--data-dir',
      '/tmp/data',
    ]);

    expect(parsed.subcommand).toBe('list');
    expect(parsed.kwargs['config-dir']).toBe('/tmp/config');
    expect(parsed.kwargs['data-dir']).toBe('/tmp/data');
  });

  it('documents storage inspection as a read-only command', () => {
    const output = getStorageUsageText();

    expect(output).toContain('xurgo-atlas storage inspect [options]');
    expect(output).toContain('xurgo-atlas storage migrate --dry-run [options]');
    expect(output).toContain('xurgo-atlas storage migrate --apply [options]');
    expect(output).toContain('storage inspect and storage migrate --dry-run are read-only.');
    expect(output).toContain('storage migrate --apply is copy-only and leaves legacy roots untouched.');
  });

  it('prints storage inspection output with no-migration wording', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-storage-cli-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const runtimeDir = path.join(dataDir, 'runtime');
    const registryPath = path.join(configDir, 'projects.json');
    const pidFile = path.join(runtimeDir, 'xurgo-atlas-daemon.json');
    const logFile = path.join(runtimeDir, 'xurgo-atlas-daemon.log');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.writeFile(
      registryPath,
      JSON.stringify({
        version: 2,
        configDir,
        dataDir,
        defaultProjectId: null,
        projects: {
          alpha: {
            projectId: 'alpha',
            projectRoot: '/tmp/alpha',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }, null, 2),
      'utf-8',
    );
    await fs.promises.writeFile(pidFile, '{}', 'utf-8');
    await fs.promises.writeFile(logFile, '', 'utf-8');

    try {
      await storageInspectCommand({ configDir, dataDir });
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

      expect(output).toContain('Xurgo Atlas storage inspection');
      expect(output).toContain(`configDir: ${configDir}`);
      expect(output).toContain(`dataDir: ${dataDir}`);
      expect(output).toContain('source: explicit');
      expect(output).toContain('registry project count: 1');
      expect(output).toContain('daemon pid file exists: yes');
      expect(output).toContain('daemon log file exists: yes');
      expect(output).toContain('No files were modified. This command does not migrate storage.');
    } finally {
      logSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('prints storage migration dry-run output with no-change wording', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'alpha'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {
            alpha: {
              projectId: 'alpha',
              projectRoot: '/tmp/alpha',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );

      try {
        await storageMigrateCommand({}, true);
        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

        expect(output).toContain('Xurgo Atlas storage migration plan');
        expect(output).toContain('Mode: dry-run');
        expect(output).toContain('Legacy-only roots found');
        expect(output).toContain('Future copy actions:');
        expect(output).toContain('No changes were made. This command did not create, copy, modify, or delete any files.');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  it('prints storage migration apply output with copy-only wording', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');
      const runtimeDir = path.join(legacyDataDir, 'runtime');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await fs.promises.mkdir(runtimeDir, { recursive: true });
      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {
            alpha: {
              projectId: 'alpha',
              projectRoot: '/tmp/alpha',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );
      await writeProjectStore(legacyDataDir, 'alpha');
      await fs.promises.writeFile(
        path.join(runtimeDir, 'xurgo-atlas-daemon.log'),
        'legacy log',
        'utf-8',
      );

      try {
        await storageMigrateCommand({}, false, true);
        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

        expect(output).toContain('Xurgo Atlas storage migration applied');
        expect(output).toContain('Mode: apply (copy-only)');
        expect(output).toContain('Projects copied: 1');
        expect(output).toContain('Runtime artifacts skipped:');
        expect(output).toContain('Atlas target roots were written.');
        expect(output).toContain('Legacy roots were left untouched.');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  it('fails clearly when storage migrate is invoked without --dry-run or --apply', async () => {
    await expect(storageMigrateCommand()).rejects.toThrow(
      getStorageMigrationNotImplementedMessage(),
    );
  });

  it('fails clearly when storage migrate is invoked with both --dry-run and --apply', async () => {
    await expect(storageMigrateCommand({}, true, true)).rejects.toThrow(
      getStorageMigrationNotImplementedMessage(),
    );
  });

  it('prints refusal guidance when apply mode is blocked', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const atlasConfigDir = path.join(configHome, 'xurgo-atlas');
      const atlasDataDir = path.join(dataHome, 'xurgo-atlas');
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {
            alpha: {
              projectId: 'alpha',
              projectRoot: '/tmp/alpha',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }, null, 2),
        'utf-8',
      );
      await writeProjectStore(legacyDataDir, 'alpha');
      await fs.promises.mkdir(atlasConfigDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(atlasConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: atlasConfigDir,
          dataDir: atlasDataDir,
          defaultProjectId: null,
          projects: {},
        }, null, 2),
        'utf-8',
      );

      await expect(storageMigrateCommand({}, false, true)).rejects.toThrow(
        'Run `xurgo-atlas storage migrate --dry-run` to inspect the copy-only plan before retrying.',
      );
    });
  });

  it('status --help exits 0 and does not start or mutate', async () => {
    const statusSpy = vi.spyOn(statusCli, 'statusCommand');

    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'status', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('xurgo-atlas status [options]');
    expect(result.stderr).toBe('');
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('daemon --help exits 0 and does not start or bind', async () => {
    const daemonSpy = vi.spyOn(daemonCli, 'daemonCommand').mockResolvedValue(undefined);
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'daemon', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Manage the Xurgo Atlas daemon');
    expect(result.stderr).toBe('');
    expect(daemonSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['storage inspect --help', ['node', 'xurgo-atlas', 'storage', 'inspect', '--help']],
    ['storage inspect -h', ['node', 'xurgo-atlas', 'storage', 'inspect', '-h']],
  ])('exits 0 without running inspection for %s', async (_label, argv) => {
    const inspectSpy = vi.spyOn(storageCli, 'storageInspectCommand').mockResolvedValue(undefined);

    const result = await runMainWithArgs(argv);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('xurgo-atlas storage inspect [options]');
    expect(result.stderr).toBe('');
    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['storage migrate --help', ['node', 'xurgo-atlas', 'storage', 'migrate', '--help']],
    ['storage migrate -h', ['node', 'xurgo-atlas', 'storage', 'migrate', '-h']],
    ['storage migrate --dry-run --help', ['node', 'xurgo-atlas', 'storage', 'migrate', '--dry-run', '--help']],
    ['storage migrate --apply --help', ['node', 'xurgo-atlas', 'storage', 'migrate', '--apply', '--help']],
  ])('exits 0 without running migration for %s', async (_label, argv) => {
    const migrateSpy = vi.spyOn(storageCli, 'storageMigrateCommand').mockResolvedValue(undefined);

    const result = await runMainWithArgs(argv);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('xurgo-atlas storage inspect [options]');
    expect(result.stdout).toContain('xurgo-atlas storage migrate');
    expect(result.stderr).toBe('');
    expect(migrateSpy).not.toHaveBeenCalled();
  });
});

// ── MCP config guidance ────────────────────────────────────────────────────

describe('mcp-config command', () => {
  it('has dedicated help text that lists all options', () => {
    const output = getMcpConfigUsageText();

    expect(output).toContain('MCP client connection guidance');
    expect(output).toContain('xurgo-atlas mcp-config [options]');
    expect(output).toContain('--host');
    expect(output).toContain('--port');
    expect(output).toContain('--json');
    expect(output).toContain('read-only');
    expect(output).toContain('does not require a project to be initialized');
  });

  it('mcp-config --help exits 0 and is non-mutating', async () => {
    const commandSpy = vi.spyOn(mcpConfigCli, 'mcpConfigCommand');
    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'mcp-config', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('xurgo-atlas mcp-config [options]');
    expect(result.stderr).toBe('');
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('exits 0 with default output including endpoint', async () => {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });

    try {
      mcpConfigCommand();
      const output = logLines.join('\n');

      expect(output).toContain('http://127.0.0.1:3737/mcp');
      expect(output).toContain('Generic MCP client JSON');
      expect(output).toContain('xurgo-atlas daemon start');
      expect(output).toContain('read-only');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('respects custom --host and --port in output', async () => {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });

    try {
      mcpConfigCommand({ host: '0.0.0.0', port: 9999 });
      const output = logLines.join('\n');

      expect(output).toContain('http://0.0.0.0:9999/mcp');
      expect(output).not.toContain('127.0.0.1');
      expect(output).not.toContain(':3737');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('prints JSON-only output with --json flag', async () => {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });

    try {
      mcpConfigCommand({ json: true });
      const output = logLines.join('\n');

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed.mcpServers['xurgo-atlas'].url).toBe('http://127.0.0.1:3737/mcp');
      expect(output).not.toContain('Endpoint:');
      expect(output).not.toContain('Generic MCP client JSON');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not require initialized storage roots (no storage access)', async () => {
    // mcpConfigCommand is purely computational — it should not need storage
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });

    try {
      // Should not throw regardless of environment
      mcpConfigCommand({ host: '127.0.0.1', port: 3737 });
      expect(logLines.join('\n')).toContain('http://127.0.0.1:3737/mcp');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('init success output', () => {
  it('shows daemon/MCP next steps after successful init', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-init-next-'));
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const projectInitSpy = vi.spyOn(Project, 'init').mockResolvedValue({} as any);
    const registryLoadSpy = vi.spyOn(Registry, 'load').mockResolvedValue({
      getProject: vi.fn().mockReturnValue(null),
      addProject: vi.fn().mockResolvedValue(undefined),
    } as any);

    try {
      await initCli.initCommand({
        projectRoot: root,
        projectId: 'test-project',
      });

      const output = logLines.join('\n');
      expect(output).toContain('✅ Xurgo Atlas project "test-project" initialized successfully');
      expect(output).toContain('xurgo-atlas daemon start');
      expect(output).toContain('MCP endpoint: http://127.0.0.1:3737/mcp');
      expect(output).toContain('MCP config snippet: xurgo-atlas mcp-config');
      expect(output).toContain('xurgo-atlas daemon status');
      expect(output).toContain('xurgo-atlas project list');
      expect(output).not.toContain('xurgo-atlas server --project-root .');
      expect(output).not.toContain('--config-dir');
      expect(output).not.toContain('--data-dir');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      projectInitSpy.mockRestore();
      registryLoadSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('includes --config-dir and --data-dir in suggested commands when explicitly provided', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-init-cfg-'));
    const configDir = path.join(root, 'my-config');
    const dataDir = path.join(root, 'my-data');
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const projectInitSpy = vi.spyOn(Project, 'init').mockResolvedValue({} as any);
    const registryLoadSpy = vi.spyOn(Registry, 'load').mockResolvedValue({
      getProject: vi.fn().mockReturnValue(null),
      addProject: vi.fn().mockResolvedValue(undefined),
    } as any);

    try {
      await initCli.initCommand({
        projectRoot: root,
        projectId: 'test-project',
        configDir,
        dataDir,
      });

      const output = logLines.join('\n');
      expect(output).toContain(`xurgo-atlas daemon start --config-dir ${configDir} --data-dir ${dataDir}`);
      expect(output).toContain(`xurgo-atlas daemon status --config-dir ${configDir} --data-dir ${dataDir}`);
      expect(output).toContain(`xurgo-atlas project list --config-dir ${configDir} --data-dir ${dataDir}`);
      expect(output).toContain('MCP endpoint: http://127.0.0.1:3737/mcp');
      expect(output).toContain('MCP config snippet: xurgo-atlas mcp-config');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      projectInitSpy.mockRestore();
      registryLoadSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('distinguishes created vs preserved files in output', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-init-output-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Pre-create existing doc files so init reports "Preserved existing"
      await fs.promises.writeFile(path.join(root, 'STATUS.md'), '# Pre-existing Status\n', 'utf-8');
      await fs.promises.writeFile(path.join(root, 'AGENTS.md'), '# Pre-existing Agents\n', 'utf-8');

      await initCli.initCommand({
        projectRoot: root,
        projectId: 'output-test',
        configDir,
        dataDir,
      });

      const output = logLines.join('\n');

      // Files that existed before init
      expect(output).toContain('Preserved existing STATUS.md');
      expect(output).toContain('Preserved existing AGENTS.md');

      // Files created by init
      expect(output).toContain('Created .docs-policy.yml');
      expect(output).toContain('Created docs/manifest.yml');

      // Overall success
      expect(output).toContain('✅ Xurgo Atlas project "output-test" initialized successfully');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

// ── Status command ────────────────────────────────────────────────────────

describe('status command', () => {
  it('exits 0 with default roots even when no registry exists', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await statusCommand();
        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

        expect(output).toContain('Xurgo Atlas setup status');
        expect(output).toContain('Mode: read-only');
        expect(output).toContain(`config dir: ${path.join(configHome, 'xurgo-atlas')}`);
        expect(output).toContain(`data dir: ${path.join(dataHome, 'xurgo-atlas')}`);
        expect(output).toContain('config source: Atlas default');
        expect(output).toContain('data source: Atlas default');
        expect(output).toContain('exists: no');
        expect(output).toContain('registered projects: 0');
        expect(output).toContain('status: not running');
        expect(output).toContain('default MCP endpoint: http://127.0.0.1:3737/mcp');
        expect(output).toContain('No files were modified');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  it('reports registered project count and default for an isolated registry', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-status-reg-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(configDir, 'projects.json'),
      JSON.stringify({
        version: 2,
        configDir,
        dataDir,
        defaultProjectId: 'my-app',
        projects: {
          'my-app': {
            projectId: 'my-app',
            projectRoot: '/tmp/my-app',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          'other-app': {
            projectId: 'other-app',
            projectRoot: '/tmp/other-app',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }, null, 2),
      'utf-8',
    );

    try {
      await statusCommand({ configDir, dataDir });
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

      expect(output).toContain('config source: CLI flag');
      expect(output).toContain('data source: CLI flag');
      expect(output).toContain('exists: yes');
      expect(output).toContain('registered projects: 2');
      expect(output).toContain('default project: my-app');
      expect(output).toContain('- my-app');
      expect(output).toContain('- other-app');
      expect(output).toContain('default MCP endpoint: http://127.0.0.1:3737/mcp');
      expect(output).toContain('No files were modified');
    } finally {
      logSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('output includes default MCP endpoint hint regardless of daemon state', async () => {
    await withXdgRoots(async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await statusCommand();
        const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

        expect(output).toContain('default MCP endpoint: http://127.0.0.1:3737/mcp');
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('status with env var roots', () => {
  it('reports env source when env vars are set', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const envConfigDir = path.join(configHome, 'status-env');
      const envDataDir = path.join(dataHome, 'status-env');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await fs.promises.mkdir(envConfigDir, { recursive: true });

      await withAtlasEnv(
        { XURGO_ATLAS_CONFIG_DIR: envConfigDir, XURGO_ATLAS_DATA_DIR: envDataDir },
        async () => {
          try {
            await statusCommand();
            const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

            expect(output).toContain(`config dir: ${envConfigDir}`);
            expect(output).toContain(`data dir: ${envDataDir}`);
            expect(output).toContain('config source: environment variable');
            expect(output).toContain('data source: environment variable');
            expect(output).toContain('No files were modified');
          } finally {
            logSpy.mockRestore();
          }
        },
      );
    });
  });

  it('prefers CLI flags over env vars', async () => {
    await withXdgRoots(async () => {
      const cliConfigDir = '/tmp/status-cli-cfg';
      const cliDataDir = '/tmp/status-cli-dat';
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await withAtlasEnv(
        { XURGO_ATLAS_CONFIG_DIR: '/tmp/status-env-cfg', XURGO_ATLAS_DATA_DIR: '/tmp/status-env-dat' },
        async () => {
          try {
            await statusCommand({ configDir: cliConfigDir, dataDir: cliDataDir });
            const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

            expect(output).toContain(`config dir: ${path.resolve(cliConfigDir)}`);
            expect(output).toContain(`data dir: ${path.resolve(cliDataDir)}`);
            expect(output).toContain('config source: CLI flag');
            expect(output).toContain('data source: CLI flag');
            expect(output).toContain('No files were modified');
          } finally {
            logSpy.mockRestore();
          }
        },
      );
    });
  });
});

// ── Environment variable root overrides ─────────────────────────────────

/**
 * Run a callback with specific XURGO_ATLAS_* env vars set, restoring
 * the previous state in a finally block.
 */
async function withAtlasEnv<T>(
  env: { XURGO_ATLAS_CONFIG_DIR?: string; XURGO_ATLAS_DATA_DIR?: string },
  run: () => Promise<T>,
): Promise<T> {
  const prevConfig = process.env.XURGO_ATLAS_CONFIG_DIR;
  const prevData = process.env.XURGO_ATLAS_DATA_DIR;

  if (env.XURGO_ATLAS_CONFIG_DIR !== undefined) {
    process.env.XURGO_ATLAS_CONFIG_DIR = env.XURGO_ATLAS_CONFIG_DIR;
  } else {
    delete process.env.XURGO_ATLAS_CONFIG_DIR;
  }
  if (env.XURGO_ATLAS_DATA_DIR !== undefined) {
    process.env.XURGO_ATLAS_DATA_DIR = env.XURGO_ATLAS_DATA_DIR;
  } else {
    delete process.env.XURGO_ATLAS_DATA_DIR;
  }

  try {
    return await run();
  } finally {
    if (prevConfig !== undefined) {
      process.env.XURGO_ATLAS_CONFIG_DIR = prevConfig;
    } else {
      delete process.env.XURGO_ATLAS_CONFIG_DIR;
    }
    if (prevData !== undefined) {
      process.env.XURGO_ATLAS_DATA_DIR = prevData;
    } else {
      delete process.env.XURGO_ATLAS_DATA_DIR;
    }
  }
}

describe('env var root overrides', () => {
  describe('resolveStorageRoots precedence', () => {
    it('uses default roots when no CLI flags or env vars are provided', async () => {
      await withXdgRoots(async ({ configHome, dataHome }) => {
        const result = storageCore.resolveStorageRoots();
        expect(result.configDir).toBe(path.join(configHome, 'xurgo-atlas'));
        expect(result.dataDir).toBe(path.join(dataHome, 'xurgo-atlas'));
        expect(result.configSource).toBe('atlas-default');
        expect(result.dataSource).toBe('atlas-default');
      });
    });

    it('uses env vars when no CLI flags are provided', async () => {
      await withXdgRoots(async () => {
        await withAtlasEnv(
          { XURGO_ATLAS_CONFIG_DIR: '/tmp/env-cfg', XURGO_ATLAS_DATA_DIR: '/tmp/env-dat' },
          async () => {
            const result = storageCore.resolveStorageRoots();
            expect(result.configDir).toBe(path.resolve('/tmp/env-cfg'));
            expect(result.dataDir).toBe(path.resolve('/tmp/env-dat'));
            expect(result.configSource).toBe('env');
            expect(result.dataSource).toBe('env');
          },
        );
      });
    });

    it('prefers CLI flags over env vars', async () => {
      await withXdgRoots(async () => {
        await withAtlasEnv(
          { XURGO_ATLAS_CONFIG_DIR: '/tmp/env-cfg', XURGO_ATLAS_DATA_DIR: '/tmp/env-dat' },
          async () => {
            const result = storageCore.resolveStorageRoots({
              configDir: '/tmp/cli-cfg',
              dataDir: '/tmp/cli-dat',
            });
            expect(result.configDir).toBe(path.resolve('/tmp/cli-cfg'));
            expect(result.dataDir).toBe(path.resolve('/tmp/cli-dat'));
            expect(result.configSource).toBe('explicit');
            expect(result.dataSource).toBe('explicit');
          },
        );
      });
    });

    it('ignores empty env var values', () => {
      const prevConfig = process.env.XURGO_ATLAS_CONFIG_DIR;
      const prevData = process.env.XURGO_ATLAS_DATA_DIR;
      try {
        process.env.XURGO_ATLAS_CONFIG_DIR = '';
        process.env.XURGO_ATLAS_DATA_DIR = '';
        const result = storageCore.resolveStorageRoots();
        // Should fall through to default — just verify source is not 'env'
        expect(result.configSource).not.toBe('env');
        expect(result.dataSource).not.toBe('env');
      } finally {
        if (prevConfig !== undefined) {
          process.env.XURGO_ATLAS_CONFIG_DIR = prevConfig;
        } else {
          delete process.env.XURGO_ATLAS_CONFIG_DIR;
        }
        if (prevData !== undefined) {
          process.env.XURGO_ATLAS_DATA_DIR = prevData;
        } else {
          delete process.env.XURGO_ATLAS_DATA_DIR;
        }
      }
    });
  });

  describe('storage inspect with env vars', () => {
    it('reports env source when env vars are set', async () => {
      await withXdgRoots(async ({ configHome, dataHome }) => {
        const envConfigDir = path.join(configHome, 'atlas-test');
        const envDataDir = path.join(dataHome, 'atlas-test');
        await fs.promises.mkdir(envConfigDir, { recursive: true });
        await fs.promises.mkdir(envDataDir, { recursive: true });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await withAtlasEnv(
          { XURGO_ATLAS_CONFIG_DIR: envConfigDir, XURGO_ATLAS_DATA_DIR: envDataDir },
          async () => {
            try {
              await storageInspectCommand();
              const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
              expect(output).toContain(`configDir: ${envConfigDir}`);
              expect(output).toContain(`dataDir: ${envDataDir}`);
              expect(output).toContain('source: env');
              expect(output).toContain('No files were modified.');
            } finally {
              logSpy.mockRestore();
            }
          },
        );
      });
    });
  });

  describe('init with env vars', () => {
    it('uses env-selected roots and shows simple next steps with env notice', async () => {
      const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-init-env-'));
      const logLines: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logLines.push(args.join(' '));
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const projectInitSpy = vi.spyOn(Project, 'init').mockResolvedValue({} as any);
      const registryLoadSpy = vi.spyOn(Registry, 'load').mockResolvedValue({
        getProject: vi.fn().mockReturnValue(null),
        addProject: vi.fn().mockResolvedValue(undefined),
      } as any);

      try {
        await withAtlasEnv(
          { XURGO_ATLAS_CONFIG_DIR: '/tmp/env-init', XURGO_ATLAS_DATA_DIR: '/tmp/env-init-data' },
          async () => {
            await initCli.initCommand({
              projectRoot: root,
              projectId: 'test-env',
            });

            const output = logLines.join('\n');
            expect(output).toContain('✅ Xurgo Atlas project "test-env" initialized successfully');
            // No flags in suggested commands (env vars handle it)
            expect(output).toContain('xurgo-atlas daemon start');
            expect(output).toContain('xurgo-atlas daemon status');
            expect(output).toContain('xurgo-atlas project list');
            // No --config-dir or --data-dir flags since none were passed
            expect(output).not.toContain('--config-dir');
            expect(output).not.toContain('--data-dir');
            // Env notice present
            expect(output).toContain('XURGO_ATLAS_CONFIG_DIR and XURGO_ATLAS_DATA_DIR from environment.');
          },
        );
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        projectInitSpy.mockRestore();
        registryLoadSpy.mockRestore();
        await fs.promises.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('help behavior regression', () => {
    it('storage inspect --help still exits 0 without running inspection', async () => {
      const inspectSpy = vi.spyOn(storageCli, 'storageInspectCommand').mockResolvedValue(undefined);
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'storage', 'inspect', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas storage inspect [options]');
      expect(inspectSpy).not.toHaveBeenCalled();
    });

    it('storage migrate --help still exits 0 without mode error', async () => {
      const migrateSpy = vi.spyOn(storageCli, 'storageMigrateCommand').mockResolvedValue(undefined);
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'storage', 'migrate', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas storage migrate');
      expect(migrateSpy).not.toHaveBeenCalled();
    });

    it('daemon --help still exits 0 without starting', async () => {
      const daemonSpy = vi.spyOn(daemonCli, 'daemonCommand').mockResolvedValue(undefined);
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'daemon', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Manage the Xurgo Atlas daemon');
      expect(daemonSpy).not.toHaveBeenCalled();
    });

    it('init --help still exits 0 without running init', async () => {
      const initSpy = vi.spyOn(initCli, 'initCommand').mockResolvedValue(undefined);
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas init [options]');
      expect(initSpy).not.toHaveBeenCalled();
    });

    it('status --help still exits 0 without running status', async () => {
      const statusSpy = vi.spyOn(statusCli, 'statusCommand');
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'status', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('xurgo-atlas status [options]');
      expect(statusSpy).not.toHaveBeenCalled();
    });
  });
});
