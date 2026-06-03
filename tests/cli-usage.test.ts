import { describe, it, expect, vi } from 'vitest';
import { printProjectUsage } from '../src/cli/project.js';

describe('CLI usage text', () => {
  it('presents Xurgo Atlas as the primary project command name', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printProjectUsage();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Manage registered Xurgo Atlas projects.');
      expect(output).toContain('xurgo-atlas project <subcommand> [options]');
      expect(output).toContain('Legacy compatibility alias remains: docu-guard project <subcommand>');
    } finally {
      logSpy.mockRestore();
    }
  });
});
