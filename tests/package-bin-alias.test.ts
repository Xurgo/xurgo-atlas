import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('package bin aliases', () => {
  it('exposes both CLI aliases on the package manifest and lockfile', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const packageLockJson = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));

    expect(packageJson.name).toBe('xurgo-atlas');
    expect(packageJson.description).toContain('Xurgo Atlas');
    expect(packageJson.keywords).toEqual(expect.arrayContaining(['xurgo-atlas', 'project-context']));
    expect(packageJson.bin).toEqual({
      'docu-guard': './dist/index.js',
      'xurgo-atlas': './dist/index.js',
    });
    expect(packageLockJson.packages[''].name).toBe('xurgo-atlas');
    expect(packageLockJson.packages[''].bin).toEqual({
      'docu-guard': 'dist/index.js',
      'xurgo-atlas': 'dist/index.js',
    });
  });
});
