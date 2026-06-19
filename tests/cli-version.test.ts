import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getVersionLine } from '../src/version.js';
function runBuiltVersionFlag(flag: '-v' | '--version', cwd: string): { status: number; stdout: string; stderr: string } {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'dist', 'index.js'), flag], {
    cwd,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI version flags', () => {
  it.each([
    ['-v', '-v'],
    ['--version', '--version'],
  ] as const)('prints a stable version line for %s in repo root and an unrelated cwd', async (_label, flag) => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-version-'));
    const expected = `${getVersionLine()}\n`;

    try {
      const repoRootResult = runBuiltVersionFlag(flag, repoRoot);
      const tmpResult = runBuiltVersionFlag(flag, tmpRoot);

      expect(repoRootResult.status).toBe(0);
      expect(repoRootResult.stdout).toBe(expected);
      expect(repoRootResult.stderr).toBe('');
      expect(tmpResult.status).toBe(0);
      expect(tmpResult.stdout).toBe(expected);
      expect(tmpResult.stderr).toBe('');
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
