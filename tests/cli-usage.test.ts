import { describe, it, expect, vi } from 'vitest';
import { getUsageText } from '../src/index.js';
import { getProjectUsageText, parseProjectArgs, printProjectUsage } from '../src/cli/project.js';

describe('CLI usage text', () => {
  it('shows atlas defaults and legacy discovery in the main help text', () => {
    const output = getUsageText();

    expect(output).toContain('xurgo-atlas — Xurgo Atlas');
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
});
