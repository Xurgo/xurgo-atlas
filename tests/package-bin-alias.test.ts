import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('package bin aliases', () => {
  it('exposes both CLI aliases on the package manifest and lockfile', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const packageLockJson = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));

    expect(packageJson.name).toBe('docu-guard-mcp');
    expect(packageJson.bin).toEqual({
      'docu-guard': './dist/index.js',
      'xurgo-atlas': './dist/index.js',
    });
    expect(packageLockJson.packages[''].name).toBe('docu-guard-mcp');
    expect(packageLockJson.packages[''].bin).toEqual({
      'docu-guard': 'dist/index.js',
      'xurgo-atlas': 'dist/index.js',
    });
  });
});
