import { describe, expect, it } from 'vitest';
import {
  FULL_VALIDATION_TIMEOUT_MS,
  executeValidationPlan,
  getValidationPlan,
  renderStepResults,
  summarizeStepError,
} from '../scripts/private-rc-artifact.mjs';

describe('private RC artifact validation gating', () => {
  it('uses a safer full validation timeout', () => {
    const plan = getValidationPlan(true);
    const validateFull = plan.find((step) => step.command === 'npm run validate:full');

    expect(validateFull?.timeout).toBe(FULL_VALIDATION_TIMEOUT_MS);
    expect(FULL_VALIDATION_TIMEOUT_MS).toBe(420_000);
  });

  it('preserves failed validate:full even if verify:installed passes later', () => {
    const plan = getValidationPlan(true);
    const result = executeValidationPlan(plan, (step) => {
      if (step.command === 'npm run validate:full') {
        return { passed: false, error: 'spawnSync /bin/sh ETIMEDOUT' };
      }
      return { passed: true };
    });

    expect(result.allValidationsPass).toBe(false);
    expect(result.validationResults).toEqual([
      { command: 'git diff --check HEAD', passed: true, skipped: false, error: null },
      { command: 'npm audit', passed: true, skipped: false, error: null },
      { command: 'npm run validate:full', passed: false, skipped: false, error: 'spawnSync /bin/sh ETIMEDOUT' },
    ]);
    expect(result.smokeResults).toEqual([
      { command: 'npm run verify:installed', passed: true, skipped: false, error: null },
    ]);
  });

  it('renders failed validation steps without a false-positive pass marker', () => {
    const summary = renderStepResults([
      { command: 'git diff --check HEAD', passed: true, skipped: false, error: null },
      { command: 'npm run validate:full', passed: false, skipped: false, error: 'spawnSync /bin/sh ETIMEDOUT' },
    ]);

    expect(summary).toContain('- [x] git diff --check HEAD');
    expect(summary).toContain('- [ ] npm run validate:full — spawnSync /bin/sh ETIMEDOUT');
    expect(summary).not.toContain('- [x] npm run validate:full');
  });

  it('uses the original error message in failure reporting', () => {
    expect(summarizeStepError(new Error('spawnSync /bin/sh ETIMEDOUT'))).toBe('spawnSync /bin/sh ETIMEDOUT');
  });
});
