import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireExclusiveStartLock,
  buildBackgroundDaemonArgs,
  daemonCommand,
  getDaemonLogPath,
  getDaemonPidFilePath,
  releaseExclusiveStartLock,
  resolveDaemonAction,
  type StartLockHandle,
} from '../src/cli/daemon.js';
import { initCommand } from '../src/cli/init.js';
import { StoragePaths } from '../src/core/storage.js';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xurgo-atlas-daemon-life-'));
}

async function withXdgRoots<T>(
  run: (roots: { root: string; configHome: string; dataHome: string }) => Promise<T>,
): Promise<T> {
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const prevDataHome = process.env.XDG_DATA_HOME;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-daemon-xdg-'));
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

async function writePidFile(
  pidFile: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.promises.writeFile(pidFile, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('daemon lifecycle helpers', () => {
  it('resolves daemon actions and rejects unknown subcommands', () => {
    expect(resolveDaemonAction(undefined)).toBe('foreground');
    expect(resolveDaemonAction('start')).toBe('start');
    expect(resolveDaemonAction('stop')).toBe('stop');
    expect(resolveDaemonAction('status')).toBe('status');
    expect(() => resolveDaemonAction('restart')).toThrow(
      'Unknown daemon subcommand: "restart"',
    );
  });

  it('builds detached daemon args without the lifecycle subcommand', () => {
    const args = buildBackgroundDaemonArgs(
      {
        action: 'start',
        host: '127.0.0.1',
        port: 3737,
        configDir: '/tmp/config',
        dataDir: '/tmp/data',
        projectId: 'demo',
        projectRoot: '/tmp/project',
      },
      '/tmp/pid.json',
    );

    expect(args).toEqual([
      'daemon',
      '--host',
      '127.0.0.1',
      '--port',
      '3737',
      '--pid-file',
      '/tmp/pid.json',
      '--config-dir',
      '/tmp/config',
      '--data-dir',
      '/tmp/data',
      '--project-id',
      'demo',
      '--project-root',
      '/tmp/project',
    ]);
  });

  it('keeps daemon runtime files under the effective data root', () => {
    const storage = new StoragePaths({
      configDir: '/tmp/config',
      dataDir: '/tmp/data',
    });

    expect(getDaemonPidFilePath(storage)).toBe(
      path.join('/tmp/data', 'runtime', 'xurgo-atlas-daemon.json'),
    );
  });

  it('uses atlas runtime paths for fresh installs', async () => {
    await withXdgRoots(async ({ dataHome }) => {
      const storage = new StoragePaths();
      const pidFile = getDaemonPidFilePath(storage);

      expect(pidFile).toBe(
        path.join(dataHome, 'xurgo-atlas', 'runtime', 'xurgo-atlas-daemon.json'),
      );
      expect(getDaemonLogPath(pidFile)).toBe(
        path.join(dataHome, 'xurgo-atlas', 'runtime', 'xurgo-atlas-daemon.log'),
      );
    });
  });

  it('uses legacy runtime paths when legacy storage is discovered', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const legacyConfigDir = path.join(configHome, 'docu-guard');
      const legacyDataDir = path.join(dataHome, 'docu-guard');

      await fs.promises.mkdir(legacyConfigDir, { recursive: true });
      await fs.promises.mkdir(path.join(legacyDataDir, 'projects', 'legacy-project'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(legacyConfigDir, 'projects.json'),
        JSON.stringify({
          version: 2,
          configDir: legacyConfigDir,
          dataDir: legacyDataDir,
          defaultProjectId: null,
          projects: {},
        }, null, 2),
        'utf-8',
      );

      const storage = new StoragePaths();
      const pidFile = getDaemonPidFilePath(storage);

      expect(pidFile).toBe(
        path.join(legacyDataDir, 'runtime', 'xurgo-atlas-daemon.json'),
      );
      expect(getDaemonLogPath(pidFile)).toBe(
        path.join(legacyDataDir, 'runtime', 'xurgo-atlas-daemon.log'),
      );
    });
  });
});

describe('daemon lifecycle commands', () => {
  it('starts a detached daemon and prints the MCP URL', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const projectRoot = path.join(root, 'project');
    const pidFile = path.join(root, 'runtime', 'daemon.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const unref = vi.fn();
    const spawnProcess = vi.fn((_command, args: string[]) => {
      const pidIndex = args.indexOf('--pid-file');
      const pidPath = args[pidIndex + 1];
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(
        pidPath,
        JSON.stringify({
          pid: 4242,
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
          startedAt: new Date().toISOString(),
        }, null, 2) + '\n',
        'utf-8',
      );
      return { pid: 4242, unref };
    });

    try {
      await fs.promises.mkdir(projectRoot, { recursive: true });
      await initCommand({
        projectRoot,
        projectId: 'demo',
        configDir,
        dataDir,
      });

      await daemonCommand(
        {
          action: 'start',
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
          projectId: 'demo',
          projectRoot,
          pidFile,
        },
        {
          spawnProcess,
          isProcessRunning: (pid) => pid === 4242,
          signalProcess: vi.fn(),
          sleep: async () => undefined,
        },
      );

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      const [, childArgs] = spawnProcess.mock.calls[0];
      expect(childArgs).toContain('daemon');
      expect(childArgs).not.toContain('start');
      expect(childArgs).toContain('--pid-file');
      expect(childArgs).toContain('--project-id');
      expect(childArgs).toContain('--project-root');
      expect(unref).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls.join('\n')).toContain(
        'Started xurgo-atlas daemon for project "demo"',
      );
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('removes stale PID files during status checks', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const storage = new StoragePaths({ configDir, dataDir });
    const pidFile = getDaemonPidFilePath(storage);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writePidFile(pidFile, {
        pid: 99999999,
        host: '127.0.0.1',
        port: 3737,
        configDir,
        dataDir,
        startedAt: new Date().toISOString(),
      });

      await daemonCommand(
        {
          action: 'status',
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
        },
        {
          isProcessRunning: () => false,
          signalProcess: vi.fn(),
          spawnProcess: vi.fn(),
          sleep: async () => undefined,
        },
      );

      expect(fs.existsSync(pidFile)).toBe(false);
      expect(logSpy.mock.calls.join('\n')).toContain('Removed stale PID file');
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('prints the bound project id and root during status checks', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const projectRoot = path.join(root, 'project');
    const storage = new StoragePaths({ configDir, dataDir });
    const pidFile = getDaemonPidFilePath(storage);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await writePidFile(pidFile, {
        pid: 4242,
        host: '127.0.0.1',
        port: 3737,
        configDir,
        dataDir,
        projectId: 'demo',
        projectRoot,
        startedAt: new Date().toISOString(),
      });

      await daemonCommand(
        {
          action: 'status',
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
        },
        {
          isProcessRunning: (pid) => pid === 4242,
          signalProcess: vi.fn(),
          spawnProcess: vi.fn(),
          sleep: async () => undefined,
        },
      );

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('daemon is running for project "demo"');
      expect(output).toContain(projectRoot);
      expect(output).toContain('http://127.0.0.1:3737/mcp');
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('stops a running daemon via SIGTERM and removes the PID file', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const pidFile = path.join(root, 'runtime', 'daemon.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const signalProcess = vi.fn((_pid: number, _signal: NodeJS.Signals | 0) => {
      running = false;
    });
    let running = true;

    try {
      await writePidFile(pidFile, {
        pid: 5252,
        host: '127.0.0.1',
        port: 3737,
        configDir,
        dataDir,
        startedAt: new Date().toISOString(),
      });

      await daemonCommand(
        {
          action: 'stop',
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
          pidFile,
        },
        {
          isProcessRunning: () => running,
          signalProcess,
          spawnProcess: vi.fn(),
          sleep: async () => undefined,
        },
      );

      expect(signalProcess).toHaveBeenCalledWith(5252, 'SIGTERM');
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(logSpy.mock.calls.join('\n')).toContain(
        'Stopped xurgo-atlas daemon (pid 5252).',
      );
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

describe('daemon start lock', () => {
  function startOptions(root: string, configDir: string, dataDir: string, projectRoot: string) {
    return {
      action: 'start' as const,
      host: '127.0.0.1',
      port: 3737,
      configDir,
      dataDir,
      projectId: 'demo',
      projectRoot,
      pidFile: path.join(root, 'runtime', 'daemon.json'),
    };
  }

  it('does not spawn when another start already holds the lock', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const projectRoot = path.join(root, 'project');
    const pidFile = path.join(root, 'runtime', 'daemon.json');
    const lockPath = `${pidFile}.lock`;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const spawnProcess = vi.fn(() => ({ pid: 4242, unref: vi.fn() }));

    try {
      await fs.promises.mkdir(projectRoot, { recursive: true });
      await initCommand({ projectRoot, projectId: 'demo', configDir, dataDir });

      const held = await acquireExclusiveStartLock(lockPath);
      expect(held).not.toBeNull();

      await daemonCommand(startOptions(root, configDir, dataDir, projectRoot), {
        spawnProcess,
        isProcessRunning: (pid) => pid === 4242,
        signalProcess: vi.fn(),
        sleep: async () => undefined,
      });

      expect(spawnProcess).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.join('\n')).toContain('already in progress');
      await releaseExclusiveStartLock(held as StartLockHandle);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('recovers a stale lock whose owner is no longer running', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const projectRoot = path.join(root, 'project');
    const pidFile = path.join(root, 'runtime', 'daemon.json');
    const lockPath = `${pidFile}.lock`;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const unref = vi.fn();
    const spawnProcess = vi.fn((_command, args: string[]) => {
      const pidIndex = args.indexOf('--pid-file');
      const pidPath = args[pidIndex + 1];
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(
        pidPath,
        JSON.stringify(
          {
            pid: 4242,
            host: '127.0.0.1',
            port: 3737,
            configDir,
            dataDir,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + '\n',
        'utf-8',
      );
      return { pid: 4242, unref };
    });

    try {
      await fs.promises.mkdir(projectRoot, { recursive: true });
      await initCommand({ projectRoot, projectId: 'demo', configDir, dataDir });

      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.promises.writeFile(
        lockPath,
        JSON.stringify({
          pid: 99999999,
          token: 'stale-owner',
          createdAt: new Date().toISOString(),
        }),
        'utf-8',
      );

      await daemonCommand(startOptions(root, configDir, dataDir, projectRoot), {
        spawnProcess,
        isProcessRunning: (pid) => pid === 4242,
        signalProcess: vi.fn(),
        sleep: async () => undefined,
      });

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls.join('\n')).toContain('Started xurgo-atlas daemon');
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('releases the lock when daemon startup fails', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const projectRoot = path.join(root, 'project');
    const pidFile = path.join(root, 'runtime', 'daemon.json');
    const releaseStartLock = vi.fn(async (_handle: StartLockHandle) => undefined);
    const spawnProcess = vi.fn(() => ({ pid: 4242, unref: vi.fn() }));

    try {
      await fs.promises.mkdir(projectRoot, { recursive: true });
      await initCommand({ projectRoot, projectId: 'demo', configDir, dataDir });

      await expect(
        daemonCommand(startOptions(root, configDir, dataDir, projectRoot), {
          spawnProcess,
          isProcessRunning: () => false,
          signalProcess: vi.fn(),
          sleep: async () => undefined,
          acquireStartLock: async (lockPath) => ({ path: lockPath, token: 'held-token' }),
          releaseStartLock,
        }),
      ).rejects.toThrow('Timed out waiting for the daemon to start.');

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(releaseStartLock).toHaveBeenCalledTimes(1);
      expect(releaseStartLock).toHaveBeenCalledWith({
        path: `${pidFile}.lock`,
        token: 'held-token',
      });
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('admits only one holder of the real exclusive-create lock', async () => {
    const root = makeTempRoot();
    const lockPath = path.join(root, 'runtime', 'daemon.json.lock');

    try {
      const first = await acquireExclusiveStartLock(lockPath);
      expect(first).not.toBeNull();
      expect(await acquireExclusiveStartLock(lockPath)).toBeNull();

      await releaseExclusiveStartLock(first as StartLockHandle);
      const afterRelease = await acquireExclusiveStartLock(lockPath);
      expect(afterRelease).not.toBeNull();
      await releaseExclusiveStartLock(afterRelease as StartLockHandle);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
