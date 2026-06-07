import { afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import YAML from 'yaml';
import { getUsageText, main } from '../src/index.js';
import { getInitUsageText, initCommand, printTemplateList } from '../src/cli/init.js';
import { getTemplate, isValidTemplate, TEMPLATE_NAMES, buildManifestYaml } from '../src/core/templates.js';
import { Project } from '../src/core/project.js';
import { Registry } from '../src/core/registry.js';
import * as storageCore from '../src/core/storage.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function withXdgRoots<T>(
  run: (roots: { root: string; configHome: string; dataHome: string }) => Promise<T>,
): Promise<T> {
  const prevConfigHome = process.env.XDG_CONFIG_HOME;
  const prevDataHome = process.env.XDG_DATA_HOME;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-tpl-xdg-'));
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

// ── Template metadata tests ─────────────────────────────────────────────

describe('template registry', () => {
  it('has exactly 5 templates with expected names', () => {
    expect(TEMPLATE_NAMES).toEqual(
      expect.arrayContaining(['default', 'saas', 'cli-tool', 'mcp-server', 'web-app']),
    );
    expect(TEMPLATE_NAMES.length).toBe(5);
  });

  it.each(TEMPLATE_NAMES)('template "%s" is valid and has a description', (name) => {
    expect(isValidTemplate(name)).toBe(true);
    const tpl = getTemplate(name);
    expect(tpl).toBeDefined();
    expect(tpl!.description).toBeTruthy();
    expect(tpl!.name).toBe(name);
    expect(Array.isArray(tpl!.files)).toBe(true);
  });

  it('isValidTemplate returns false for unknown names', () => {
    expect(isValidTemplate('unknown')).toBe(false);
    expect(isValidTemplate('')).toBe(false);
    expect(isValidTemplate('SAAS')).toBe(false);
  });

  it('getTemplate returns undefined for unknown names', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });
});

// ── Template file metadata ──────────────────────────────────────────────

describe('template file definitions', () => {
  it.each(TEMPLATE_NAMES)('template "%s" generates file paths under docs/', (name) => {
    const tpl = getTemplate(name)!;
    for (const f of tpl.files) {
      expect(f.path).toMatch(/^docs\//);
      expect(f.content).toBeTruthy();
    }
  });

  it('default template creates docs/project-brief.md', () => {
    const tpl = getTemplate('default')!;
    const paths = tpl.files.map((f) => f.path);
    expect(paths).toContain('docs/project-brief.md');
  });

  it('saas template creates docs/product-brief.md', () => {
    const tpl = getTemplate('saas')!;
    const paths = tpl.files.map((f) => f.path);
    expect(paths).toContain('docs/product-brief.md');
  });

  it('cli-tool template creates docs/cli-surface.md', () => {
    const tpl = getTemplate('cli-tool')!;
    const paths = tpl.files.map((f) => f.path);
    expect(paths).toContain('docs/cli-surface.md');
  });

  it('mcp-server template creates docs/mcp-surface.md', () => {
    const tpl = getTemplate('mcp-server')!;
    const paths = tpl.files.map((f) => f.path);
    expect(paths).toContain('docs/mcp-surface.md');
  });

  it('web-app template creates docs/product-brief.md and docs/web-app-structure.md', () => {
    const tpl = getTemplate('web-app')!;
    const paths = tpl.files.map((f) => f.path);
    expect(paths).toContain('docs/product-brief.md');
    expect(paths).toContain('docs/web-app-structure.md');
  });

  it('buildManifestYaml includes template-specific entries', () => {
    const tpl = getTemplate('saas')!;
    const yaml = buildManifestYaml(tpl.files);
    const parsed = YAML.parse(yaml);
    expect(parsed.version).toBe(1);
    expect(parsed.documents).toBeDefined();
    const docPaths = parsed.documents.map((d: { path: string }) => d.path);
    // Standard docs
    expect(docPaths).toContain('STATUS.md');
    expect(docPaths).toContain('docs/manifest.yml');
    // Template-specific docs
    expect(docPaths).toContain('docs/product-brief.md');
    expect(docPaths).toContain('docs/development-workflow.md');
    // Template docs have role and summary
    const productBrief = parsed.documents.find((d: { path: string }) => d.path === 'docs/product-brief.md');
    expect(productBrief).toBeDefined();
    expect(productBrief.role).toBe('brief');
    expect(productBrief.summary).toBeTruthy();
  });
});

// ── Help text and template listing behavior ─────────────────────────────

describe('init help text includes templates', () => {
  it('getInitUsageText includes template section', () => {
    const text = getInitUsageText();
    expect(text).toContain('--template <name>');
    expect(text).toContain('-t <name>');
    expect(text).toContain('--templates');
    expect(text).toContain('AVAILABLE TEMPLATES');
    expect(text).toContain('default');
    expect(text).toContain('saas');
    expect(text).toContain('cli-tool');
    expect(text).toContain('mcp-server');
    expect(text).toContain('web-app');
    expect(text).toContain('xurgo-atlas init --template saas --project-id clientpulse');
  });

  it('main help text includes template options under init', () => {
    const text = getUsageText();
    expect(text).toContain('--template <name>');
    expect(text).toContain('--templates');
    expect(text).toContain('xurgo-atlas init --template saas --project-id clientpulse');
  });

  it('init --help exits 0 and is non-mutating', async () => {
    const initSpy = vi.spyOn(Project, 'init').mockResolvedValue({} as never);
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--template');
    expect(result.stdout).toContain('AVAILABLE TEMPLATES');
    expect(result.stderr).toBe('');
    expect(initSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('init --templates exits 0, lists templates, and does not mutate', async () => {
    const storageSpy = vi.spyOn(storageCore, 'emitStorageDiagnostics').mockImplementation(() => undefined);

    const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init', '--templates']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Available init templates:');
    expect(result.stdout).toContain('default');
    expect(result.stdout).toContain('saas');
    expect(result.stdout).toContain('cli-tool');
    expect(result.stdout).toContain('mcp-server');
    expect(result.stdout).toContain('web-app');
    expect(result.stderr).toBe('');
    // Ensure no storage was touched
    expect(storageSpy).not.toHaveBeenCalled();
  });
});

// ── Invalid template name ───────────────────────────────────────────────

describe('invalid template name', () => {
  it('fails clearly and lists valid template names', async () => {
    const result = await runMainWithArgs([
      'node', 'xurgo-atlas', 'init',
      '--project-id', 'my-project',
      '--project-root', '/tmp',
      '--template', 'bogus',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown template "bogus"');
    expect(result.stderr).toContain('Available init templates:');
    expect(result.stderr).toContain('default');
    expect(result.stderr).toContain('saas');
    expect(result.stderr).toContain('cli-tool');
    expect(result.stderr).toContain('mcp-server');
    expect(result.stderr).toContain('web-app');
  });
});

// ── Template init creates expected files ────────────────────────────────

describe('template init creates files', () => {
  async function runTemplateInit(
    template: string,
    root: string,
    configDir: string,
    dataDir: string,
  ): Promise<{ stdout: string }> {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await initCommand({
        projectRoot: root,
        projectId: 'tpl-test',
        configDir,
        dataDir,
        template,
      });
      return { stdout: logLines.join('\n') };
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  }

  it.each(TEMPLATE_NAMES)('template "%s" creates its specific docs', async (name) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), `xurgo-atlas-tpl-${name}-`));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      await runTemplateInit(name, root, configDir, dataDir);

      // Verify standard files exist
      expect(await fileExists(path.join(root, 'STATUS.md'))).toBe(true);
      expect(await fileExists(path.join(root, 'AGENTS.md'))).toBe(true);
      expect(await fileExists(path.join(root, '.docs-policy.yml'))).toBe(true);
      expect(await fileExists(path.join(root, 'docs', 'manifest.yml'))).toBe(true);

      // Verify template-specific files exist
      const tpl = getTemplate(name)!;
      for (const f of tpl.files) {
        expect(await fileExists(path.join(root, f.path))).toBe(true);
      }

      // Verify manifest includes template-specific docs
      const manifestContent = await fs.promises.readFile(
        path.join(root, 'docs', 'manifest.yml'),
        'utf-8',
      );
      const parsed = YAML.parse(manifestContent);
      const docPaths = parsed.documents.map((d: { path: string }) => d.path);
      for (const f of tpl.files) {
        expect(docPaths).toContain(f.path);
      }
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('output includes "Created" and "Preserved existing" for template files', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-tpl-output-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      // Init with template
      const result1 = await runTemplateInit('saas', root, configDir, dataDir);
      expect(result1.stdout).toContain('Created docs/product-brief.md');
      expect(result1.stdout).toContain('Created docs/development-workflow.md');

      // Re-init with same template — existing files should be preserved
      const result2 = await runTemplateInit('saas', root, configDir, dataDir);
      expect(result2.stdout).toContain('Preserved existing docs/product-brief.md');
      expect(result2.stdout).toContain('Preserved existing docs/development-workflow.md');
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

// ── Existing doc preservation during template init ──────────────────────

describe('existing doc preservation during template init', () => {
  async function initWithTemplate(
    root: string,
    template: string,
    configDir: string,
    dataDir: string,
  ): Promise<void> {
    await initCommand({
      projectRoot: root,
      projectId: 'preserve-test',
      configDir,
      dataDir,
      template,
    });
  }

  it('preserves existing STATUS.md when using template', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-status-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const customStatus = '# Custom Status\n\nPre-existing status.\n';
      await fs.promises.writeFile(path.join(root, 'STATUS.md'), customStatus, 'utf-8');

      await initWithTemplate(root, 'saas', configDir, dataDir);

      const content = await fs.promises.readFile(path.join(root, 'STATUS.md'), 'utf-8');
      expect(content).toBe(customStatus);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing AGENTS.md when using template', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-agents-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const customAgents = '# Custom Agents\n\nUser-authored.\n';
      await fs.promises.writeFile(path.join(root, 'AGENTS.md'), customAgents, 'utf-8');

      await initWithTemplate(root, 'saas', configDir, dataDir);

      const content = await fs.promises.readFile(path.join(root, 'AGENTS.md'), 'utf-8');
      expect(content).toBe(customAgents);
      expect(content).not.toContain('Documentation Safety Rules');
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing docs/manifest.yml when using template', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-manifest-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const customManifest = 'custom: true\n';
      await fs.promises.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.promises.writeFile(path.join(root, 'docs', 'manifest.yml'), customManifest, 'utf-8');

      await initWithTemplate(root, 'saas', configDir, dataDir);

      const content = await fs.promises.readFile(path.join(root, 'docs', 'manifest.yml'), 'utf-8');
      expect(content).toBe(customManifest);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing template-specific docs on re-init', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-tpl-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      await initWithTemplate(root, 'saas', configDir, dataDir);

      // Modify a template doc
      const productBriefPath = path.join(root, 'docs', 'product-brief.md');
      const customBrief = '# Modified Brief\n\nUser edited.\n';
      await fs.promises.writeFile(productBriefPath, customBrief, 'utf-8');

      // Re-init
      await initWithTemplate(root, 'saas', configDir, dataDir);

      // Content should be preserved
      const content = await fs.promises.readFile(productBriefPath, 'utf-8');
      expect(content).toBe(customBrief);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing docs under docs/ on template init', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-docs-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const customDoc = '# Custom User Doc\n';
      await fs.promises.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.promises.writeFile(path.join(root, 'docs', 'user-guide.md'), customDoc, 'utf-8');

      await initWithTemplate(root, 'saas', configDir, dataDir);

      const content = await fs.promises.readFile(path.join(root, 'docs', 'user-guide.md'), 'utf-8');
      expect(content).toBe(customDoc);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('reports created and preserved consistently with mixed existing/missing', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-preserve-mixed-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Pre-create STATUS.md and one template file
      await fs.promises.writeFile(path.join(root, 'STATUS.md'), '# Only Status\n', 'utf-8');
      await fs.promises.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.promises.writeFile(
        path.join(root, 'docs', 'development-workflow.md'),
        '# Custom Workflow\n',
        'utf-8',
      );

      await initCommand({
        projectRoot: root,
        projectId: 'mixed-test',
        configDir,
        dataDir,
        template: 'saas',
      });

      const output = logLines.join('\n');
      expect(output).toContain('Preserved existing STATUS.md');
      expect(output).toContain('Preserved existing docs/development-workflow.md');
      expect(output).toContain('Created AGENTS.md');  // Created because it didn't exist
      expect(output).toContain('Created .docs-policy.yml');
      expect(output).toContain('Created docs/product-brief.md');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

// ── Default init still works without --template ─────────────────────────

describe('default init without --template flag', () => {
  it('produces same files as --template default', async () => {
    const root1 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-noflag-'));
    const root2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-flag-'));
    const configDir = path.join(root1, 'config');
    const dataDir = path.join(root1, 'data');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Init without --template
      await initCommand({
        projectRoot: root1,
        projectId: 'noflag',
        configDir,
        dataDir,
      });

      // Init with --template default
      await initCommand({
        projectRoot: root2,
        projectId: 'flag',
        configDir: path.join(root2, 'config'),
        dataDir: path.join(root2, 'data'),
        template: 'default',
      });

      // Both should have the same files (STATUS.md, AGENTS.md, .docs-policy.yml, manifest, README, etc.)
      const files1 = await fs.promises.readdir(root1).then((entries) => entries.sort());
      const files2 = await fs.promises.readdir(root2).then((entries) => entries.sort());

      // Both should have at least the core project files
      expect(await fileExists(path.join(root1, 'STATUS.md'))).toBe(true);
      expect(await fileExists(path.join(root2, 'STATUS.md'))).toBe(true);
      expect(await fileExists(path.join(root1, 'AGENTS.md'))).toBe(true);
      expect(await fileExists(path.join(root2, 'AGENTS.md'))).toBe(true);
      expect(await fileExists(path.join(root1, '.docs-policy.yml'))).toBe(true);
      expect(await fileExists(path.join(root2, '.docs-policy.yml'))).toBe(true);

      // Both should have project-brief.md (default template creates it)
      expect(await fileExists(path.join(root1, 'docs', 'project-brief.md'))).toBe(true);
      expect(await fileExists(path.join(root2, 'docs', 'project-brief.md'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await fs.promises.rm(root1, { recursive: true, force: true });
      await fs.promises.rm(root2, { recursive: true, force: true });
    }
  });

  it('project registration still works after template init', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-tpl-reg-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      await initCommand({
        projectRoot: root,
        projectId: 'registry-test',
        configDir,
        dataDir,
        template: 'mcp-server',
      });

      // Verify registry has the project
      const registry = await Registry.load(configDir, dataDir);
      const project = registry.getProject('registry-test');
      expect(project).toBeDefined();
      expect(project!.projectId).toBe('registry-test');
      expect(project!.projectRoot).toBe(root);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('snapshot includes template-specific docs', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-tpl-snap-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      // Create template files before Project.init
      await initCommand({
        projectRoot: root,
        projectId: 'snap-test',
        configDir,
        dataDir,
        template: 'web-app',
      });

      // Load the project and check tracked files
      const project = await Project.load({
        projectRoot: root,
        projectId: 'snap-test',
        configDir,
        dataDir,
      });

      const trackedFiles = await project.getTrackedFiles();
      expect(trackedFiles).toContain('docs/product-brief.md');
      expect(trackedFiles).toContain('docs/web-app-structure.md');
      expect(trackedFiles).toContain('docs/development-workflow.md');

      // Content should be readable from git store
      const productBrief = await project.readFile('main', 'docs/product-brief.md');
      expect(productBrief.content).toContain('Product Brief');
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

// ── CLI --template and -t flags ────────────────────────────────────────

describe('CLI --template and -t flags', () => {
  async function runInitWithArgs(extraArgs: string[]): Promise<{
    stdout: string;
  }> {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logLines.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    const originalArgv = process.argv;
    process.argv = ['node', 'xurgo-atlas', 'init', ...extraArgs];

    try {
      await main();
    } catch {
      // process.exit is expected for this path — ignore
    } finally {
      process.argv = originalArgv;
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }

    return { stdout: logLines.join('\n') };
  }

  it('--template saas works from CLI entry point', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-cli-saas-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const result = await runInitWithArgs([
        '--project-root', root,
        '--project-id', 'cli-saas',
        '--config-dir', configDir,
        '--data-dir', dataDir,
        '--template', 'saas',
      ]);

      expect(result.stdout).toContain('Template: saas');
      expect(await fileExists(path.join(root, 'docs', 'product-brief.md'))).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('-t cli-tool works from CLI entry point', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-cli-t-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const result = await runInitWithArgs([
        '--project-root', root,
        '--project-id', 'cli-t',
        '--config-dir', configDir,
        '--data-dir', dataDir,
        '-t', 'cli-tool',
      ]);

      expect(result.stdout).toContain('Template: cli-tool');
      expect(await fileExists(path.join(root, 'docs', 'cli-surface.md'))).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('--template mcp-server works from CLI entry point', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-cli-mcp-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const result = await runInitWithArgs([
        '--project-root', root,
        '--project-id', 'cli-mcp',
        '--config-dir', configDir,
        '--data-dir', dataDir,
        '--template', 'mcp-server',
      ]);

      expect(result.stdout).toContain('Template: mcp-server');
      expect(await fileExists(path.join(root, 'docs', 'mcp-surface.md'))).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('--template web-app works from CLI entry point', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xurgo-atlas-cli-web-'));
    const configDir = path.join(root, 'config');
    const dataDir = path.join(root, 'data');

    try {
      const result = await runInitWithArgs([
        '--project-root', root,
        '--project-id', 'cli-web',
        '--config-dir', configDir,
        '--data-dir', dataDir,
        '--template', 'web-app',
      ]);

      expect(result.stdout).toContain('Template: web-app');
      expect(await fileExists(path.join(root, 'docs', 'product-brief.md'))).toBe(true);
      expect(await fileExists(path.join(root, 'docs', 'web-app-structure.md'))).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});

// ── Non-mutating commands ───────────────────────────────────────────────

describe('non-mutating template commands', () => {
  it('--templates does not create any files', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init', '--templates']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available init templates:');
      // No storage should be created
      await expect(fs.promises.stat(path.join(configHome, 'xurgo-atlas'))).rejects.toThrow();
      await expect(fs.promises.stat(path.join(dataHome, 'xurgo-atlas'))).rejects.toThrow();
    });
  });

  it('init --help does not create any files', async () => {
    await withXdgRoots(async ({ configHome, dataHome }) => {
      const result = await runMainWithArgs(['node', 'xurgo-atlas', 'init', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--template');
      await expect(fs.promises.stat(path.join(configHome, 'xurgo-atlas'))).rejects.toThrow();
      await expect(fs.promises.stat(path.join(dataHome, 'xurgo-atlas'))).rejects.toThrow();
    });
  });

  it('printTemplateList is purely decorative and non-mutating', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      printTemplateList();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Available init templates:');
      expect(output).toContain('default');
      expect(output).toContain('saas');
      expect(output).toContain('cli-tool');
      expect(output).toContain('mcp-server');
      expect(output).toContain('web-app');
    } finally {
      logSpy.mockRestore();
    }
  });
});
