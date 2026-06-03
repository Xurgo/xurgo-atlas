import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildBackgroundDaemonArgs,
  daemonCommand,
  getDaemonPidFilePath,
  resolveDaemonAction,
} from '../src/cli/daemon.js';
import { StoragePaths } from '../src/core/storage.js';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xurgo-atlas-daemon-life-'));
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
});

describe('daemon lifecycle commands', () => {
  it('starts a detached daemon and prints the MCP URL', async () => {
    const root = makeTempRoot();
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
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
      await daemonCommand(
        {
          action: 'start',
          host: '127.0.0.1',
          port: 3737,
          configDir,
          dataDir,
          projectId: 'demo',
          projectRoot: '/tmp/project',
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
        'Started xurgo-atlas daemon at http://127.0.0.1:3737/mcp.',
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
