import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getUsageText } from '../src/index.js';
import { getProjectUsageText, parseProjectArgs, printProjectUsage } from '../src/cli/project.js';
import {
  getStorageMigrationNotImplementedMessage,
  getStorageUsageText,
  storageInspectCommand,
  storageMigrateCommand,
} from '../src/cli/storage.js';

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

describe('CLI usage text', () => {
  it('shows atlas defaults and legacy discovery in the main help text', () => {
    const output = getUsageText();

    expect(output).toContain('xurgo-atlas — Xurgo Atlas');
    expect(output).toContain('storage    Inspect Atlas-vs-legacy managed storage (read-only)');
    expect(output).toContain('default: ~/.config/xurgo-atlas; legacy docu-guard roots auto-discovered');
    expect(output).toContain('default: ~/.local/share/xurgo-atlas; legacy docu-guard roots auto-discovered');
    expect(output).toContain('Legacy compatibility alias remains: docu-guard');
  });

  it('presents Xurgo Atlas as the primary project command name', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printProjectUsage();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Manage registered Xurgo Atlas projects.');
      expect(output).toContain('xurgo-atlas project <subcommand> [options]');
      expect(output).toContain('default: ~/.config/xurgo-atlas; legacy docu-guard roots auto-discovered');
      expect(output).toContain('default: ~/.local/share/xurgo-atlas; legacy docu-guard roots auto-discovered');
      expect(output).toContain('Legacy compatibility alias remains: docu-guard project <subcommand>');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('keeps the temporary docu-guard alias documented in project help text', () => {
    const output = getProjectUsageText();

    expect(output).toContain('Legacy alias: docu-guard (temporary)');
    expect(output).toContain('Legacy compatibility alias remains: docu-guard project <subcommand>');
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
});
