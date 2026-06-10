#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Xurgo Atlas — Private RC Artifact Script
//
//  Creates a private release-candidate tarball artifact bundle
//  from the current checkout, with validation gates and an
//  isolated installed-package smoke check.
//
//  USAGE:
//    npm run bundle:private-rc
//    npm run bundle:private-rc -- --skip-full-validation
//    npm run bundle:private-rc -- --keep-temp
//    npm run bundle:private-rc -- --out ./my-artifacts
//    npm run bundle:private-rc -- --allow-diverged
//    node scripts/private-rc-artifact.mjs    (direct invocation)
//
//  FLAGS:
//    --skip-full-validation   Skip `npm run validate:full` (unsafe for
//                             real RC, intended for dev iteration)
//    --keep-temp              Preserve temp install/smoke workspaces
//    --out <dir>              Artifact output directory (default:
//                             artifacts/private-rc/<ts>-<short-head>/)
//    --allow-diverged         Proceed even if local HEAD differs from
//                             origin/main (unsafe for real RC)
//
//  The script does NOT tag, push, publish, modify package version,
//  modify source files, or run public release commands.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── Paths ────────────────────────────────────────────────────
const __filename     = fileURLToPath(import.meta.url);
const __dirname      = path.dirname(__filename);
const REPO_ROOT      = path.resolve(__dirname, '..');
const DEFAULT_OUT    = path.join(REPO_ROOT, 'artifacts', 'private-rc');
export const FULL_VALIDATION_TIMEOUT_MS = 420_000;

// ─── Formatting ───────────────────────────────────────────────
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';

function info(label, value) {
  console.log(`  ${DIM}${label}:${RESET} ${value}`);
}

function heading(text) {
  const line = '─'.repeat(Math.min(text.length + 4, 72));
  console.log(`\n${line}\n  ${text}\n${line}`);
}

function step(label, fn) {
  try {
    fn();
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    return true;
  } catch (e) {
    console.log(`  ${RED}✗${RESET} ${label}`);
    console.error(`    ${DIM}${e.message || e}${RESET}`);
    return false;
  }
}

function fail(label, msg) {
  console.log(`  ${RED}✗${RESET} ${label}`);
  console.error(`    ${DIM}${msg}${RESET}`);
  process.exit(1);
}

export function summarizeStepError(error) {
  if (!error) return 'Step failed';
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function createStepResult(command, passed, error = null, skipped = false) {
  return {
    command,
    passed,
    skipped,
    error: passed || skipped ? null : (error || 'Step failed'),
  };
}

export function renderStepResults(results, emptyLabel = '- (none)') {
  if (!results.length) return emptyLabel;
  return results.map((result) => {
    if (result.skipped) return `- [ ] ${result.command} (skipped)`;
    if (result.passed) return `- [x] ${result.command}`;
    return `- [ ] ${result.command}${result.error ? ` — ${result.error}` : ''}`;
  }).join('\n');
}

export function executeValidationPlan(plan, runStep) {
  const validationResults = [];
  const smokeResults = [];
  let allValidationsPass = true;

  for (const stepDef of plan) {
    const outcome = runStep(stepDef);
    const result = createStepResult(
      stepDef.command,
      outcome.passed,
      outcome.error ?? null,
      outcome.skipped ?? false,
    );

    if (stepDef.kind === 'smoke') {
      smokeResults.push(result);
    } else {
      validationResults.push(result);
    }

    if (stepDef.gatesOverallValidation) {
      allValidationsPass = allValidationsPass && result.passed;
    }
  }

  return { allValidationsPass, validationResults, smokeResults };
}

export function getValidationPlan(isValidating) {
  const plan = [
    { kind: 'validation', command: 'git diff --check HEAD', gatesOverallValidation: true },
    { kind: 'validation', command: 'npm audit', gatesOverallValidation: true, timeout: 60_000 },
  ];

  if (isValidating) {
    plan.push(
      {
        kind: 'validation',
        command: 'npm run validate:full',
        gatesOverallValidation: true,
        timeout: FULL_VALIDATION_TIMEOUT_MS,
      },
      {
        kind: 'smoke',
        command: 'npm run verify:installed',
        gatesOverallValidation: true,
        timeout: 300_000,
      },
    );
  } else {
    plan.push(
      {
        kind: 'validation',
        command: 'npm run validate:quick (--skip-full-validation)',
        gatesOverallValidation: true,
        timeout: 60_000,
      },
      {
        kind: 'validation',
        command: 'npm run build (--skip-full-validation)',
        gatesOverallValidation: true,
        timeout: 60_000,
      },
    );
  }

  return plan;
}

// ─── Shell helpers ────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd:      opts.cwd || REPO_ROOT,
    env:      opts.env || process.env,
    stdio:    opts.silent ? 'pipe' : 'inherit',
    timeout:  opts.timeout || 120_000,
    encoding: 'utf-8',
  });
}

function runOutput(cmd, opts = {}) {
  return execSync(cmd, {
    cwd:      opts.cwd || REPO_ROOT,
    env:      opts.env || process.env,
    stdio:    'pipe',
    timeout:  opts.timeout || 30_000,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });
}

// ─── Git helpers ──────────────────────────────────────────────
function git(args) {
  return runOutput(`git ${args}`).toString().trim();
}

// ─── Crypto ───────────────────────────────────────────────────
function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─── Timestamp ────────────────────────────────────────────────
function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ─── Bundle wrapper generators ──────────────────────────────

function generateBundlePackageJson() {
  return JSON.stringify({
    private: true,
    name: 'xurgo-atlas-private-rc-bundle',
    version: '0.0.0-private-rc',
    description: 'Private Xurgo Atlas RC reviewer bundle. This is not the product package.',
    type: 'module',
    scripts: {
      smoke: 'node REVIEWER_INSTALL_SMOKE.mjs',
      'smoke:keep': 'node REVIEWER_INSTALL_SMOKE.mjs --keep',
    },
  }, null, 2) + '\n';
}

function generateNpmrc() {
  return [
    '# Private RC bundle — prevent accidental publish or lockfile noise.',
    'save=false',
    'package-lock=false',
    'fund=false',
    'audit=false',
    '',
  ].join('\n');
}

// ─── Reviewer installer script generator ─────────────────────
function generateReviewerSmokeScript(tarballName) {
  return `#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Xurgo Atlas — Private RC Reviewer Install & Smoke Script
//
//  This file was auto-generated by \`npm run bundle:private-rc\`.
//
//  Installs the tarball in this directory into a fresh isolated
//  consumer workspace and runs basic commands to verify the
//  package is functional.
//
//  USAGE (from the artifact bundle directory):
//    node REVIEWER_INSTALL_SMOKE.mjs
//    node REVIEWER_INSTALL_SMOKE.mjs --keep
//
//  FLAGS:
//    --keep    Preserve the temp consumer workspace on exit
//
//  This script does NOT modify the artifact bundle directory.
//  It does NOT create package.json or node_modules here.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── Tarball ──────────────────────────────────────────────────
const TARBALL_NAME  = '${tarballName}';

// ─── Paths ────────────────────────────────────────────────────
const SCRIPT_DIR    = path.dirname(fileURLToPath(import.meta.url));
const TARBALL_PATH  = path.join(SCRIPT_DIR, TARBALL_NAME);

// ─── Formatting ───────────────────────────────────────────────
const BOLD  = '\\x1b[1m';
const DIM   = '\\x1b[2m';
const GREEN = '\\x1b[32m';
const RED   = '\\x1b[31m';
const RESET = '\\x1b[0m';

// ─── Step runner ──────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const results = [];

function step(label, fn) {
  try {
    fn();
    results.push({ label, ok: true });
    passCount++;
    console.log(\`  \${GREEN}\\u2713\${RESET} \${label}\`);
  } catch (e) {
    results.push({ label, ok: false, detail: e.message });
    failCount++;
    console.log(\`  \${RED}\\u2717\${RESET} \${label}\`);
    console.error(\`    \${DIM}\${e.message}\${RESET}\`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function run(cmd, opts = {}) {
  execSync(cmd, {
    cwd:      opts.cwd || SCRIPT_DIR,
    env:      opts.env || process.env,
    stdio:    opts.silent ? 'pipe' : 'inherit',
    timeout:  opts.timeout || 120_000,
    encoding: 'utf-8',
  });
}

function runOutput(cmd, opts = {}) {
  return execSync(cmd, {
    cwd:      opts.cwd || SCRIPT_DIR,
    env:      opts.env || process.env,
    stdio:    'pipe',
    timeout:  opts.timeout || 30_000,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });
}

// ─── Main ─────────────────────────────────────────────────────
function main() {
  const keep = process.argv.slice(2).includes('--keep');

  console.log(\`${BOLD}\\n  Xurgo Atlas — Private RC Install & Smoke\${RESET}\\n\`);

  // ── Locate tarball ──────────────────────────────────────────
  if (!fs.existsSync(TARBALL_PATH)) {
    console.error(\`\${RED}Tarball not found: \${TARBALL_PATH}\${RESET}\`);
    console.error(\`Expected: \${TARBALL_NAME} in \${SCRIPT_DIR}\`);
    process.exit(1);
  }
  console.log(\`  \${DIM}Tarball:\${RESET} \${TARBALL_PATH}\\n\`);

  // ── Create temp consumer workspace ──────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-rc-smoke-'));
  console.log(\`  \${DIM}Consumer workspace:\${RESET} \${tmpDir}\\n\`);

  let allOk = true;

  try {
    step('npm init consumer workspace', () => {
      run('npm init -y', { cwd: tmpDir, silent: true });
    });

    step('npm install tarball', () => {
      run(\`npm install "\${TARBALL_PATH}"\`, { cwd: tmpDir, timeout: 120_000, silent: true });
    });

    const binPath = path.join(tmpDir, 'node_modules', '.bin', 'xurgo-atlas');
    step('binary exists', () => {
      if (!fs.existsSync(binPath)) throw new Error(\`binary not found at \${binPath}\`);
    });

    const consumerEnv = {
      ...process.env,
      XURGO_ATLAS_CONFIG_DIR: path.join(tmpDir, 'xa-config'),
      XURGO_ATLAS_DATA_DIR:   path.join(tmpDir, 'xa-data'),
    };

    function xaCheck(stepLabel, args) {
      step(stepLabel, () => {
        const out = runOutput(\`"\${binPath}" \${args}\`, { env: consumerEnv, cwd: tmpDir });
        if (!out || out.trim().length === 0) throw new Error('No output from command');
      });
    }

    xaCheck('xurgo-atlas --help', '--help');
    xaCheck('xurgo-atlas status --help', 'status --help');
    xaCheck('xurgo-atlas mcp-config --help', 'mcp-config --help');

    step('xurgo-atlas mcp-config --json (valid JSON + expected structure)', () => {
      const out = runOutput(\`"\${binPath}" mcp-config --json\`, { env: consumerEnv, cwd: tmpDir });
      let parsed;
      try { parsed = JSON.parse(out.trim()); } catch {
        throw new Error('mcp-config --json output is not valid JSON');
      }
      if (!parsed.mcpServers?.['xurgo-atlas']?.url) {
        throw new Error('mcpServers.xurgo-atlas.url missing in JSON output');
      }
    });

  } finally {
    // ── Report ────────────────────────────────────────────────
    const total  = passCount + failCount;
    const passed = failCount === 0;
    console.log('');
    console.log(\`  \${BOLD}Results: \${passCount}/\${total} passed, \${failCount} failed\${RESET}\`);
    console.log(\`  \${BOLD}Verdict: \${passed ? \`\${GREEN}PASS\${RESET}\` : \`\${RED}FAIL\${RESET}\`}\${RESET}\\n\`);

    allOk = passed;
    if (!allOk) process.exitCode = 1;

    // ── Cleanup ────────────────────────────────────────────────
    if (!keep) {
      const tmpdirBase = os.tmpdir();
      const base       = path.basename(tmpDir);
      const safe       = tmpDir.startsWith(tmpdirBase)
                      && tmpDir !== tmpdirBase
                      && base.startsWith('xa-rc-smoke-');
      if (safe) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          console.log(\`  \${DIM}Temp workspace cleaned up.\${RESET}\\n\`);
        } catch (e) {
          console.error(\`  \${DIM}Cleanup warning: \${e.message}\${RESET}\\n\`);
        }
      } else {
        console.error(\`  \${RED}Refusing to remove path that does not look like\${RESET}\`);
        console.error(\`  \${RED}the smoke temp workspace: \${tmpDir}\${RESET}\\n\`);
      }
    } else {
      console.log(\`  \${DIM}Temp workspace preserved: \${tmpDir}\${RESET}\\n\`);
    }
  }
}

main();
`;
}

// ─── Main ─────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const skipFullValidation = argv.includes('--skip-full-validation');
  const keepTemp           = argv.includes('--keep-temp');
  const allowDiverged      = argv.includes('--allow-diverged');
  const outIdx             = argv.indexOf('--out');
  const customOutDir       = outIdx !== -1 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : null;

  const isValidating = !skipFullValidation;

  // ── Gate: clean working tree ────────────────────────────────
  console.log(`${BOLD}\n  Xurgo Atlas — Private RC Artifact${RESET}\n`);

  const statusShort = git('status --short');
  if (statusShort) {
    console.log(`${RED}Working tree is not clean:${RESET}`);
    for (const line of statusShort.split('\n').filter(Boolean)) {
      console.log(`  ${line}`);
    }
    process.exit(1);
  }

  // ── Gather git info ─────────────────────────────────────────
  const branch      = git('rev-parse --abbrev-ref HEAD');
  const head        = git('rev-parse HEAD');
  const shortHead   = head.slice(0, 7);

  let originMain = null;
  try {
    originMain = git('rev-parse origin/main');
  } catch { /* not all checkouts have a remote */ }

  // Warn if not on main
  if (branch !== 'main') {
    console.log(`  ${DIM}Note: on branch "${branch}", not "main".${RESET}`);
  }

  // Warn / gate on divergence
  if (originMain && head !== originMain) {
    const behind = parseInt(git('rev-list --count HEAD..origin/main'), 10);
    const ahead  = parseInt(git('rev-list --count origin/main..HEAD'), 10);
    const parts = [];
    if (behind > 0) parts.push(`${behind} behind`);
    if (ahead  > 0) parts.push(`${ahead} ahead`);
    const msg = `Local HEAD differs from origin/main (${parts.join(', ')})`;
    if (allowDiverged) {
      console.log(`  ${DIM}Warning: ${msg} (--allow-diverged, continuing)${RESET}`);
    } else {
      fail('origin/main synced', `${msg}. Use --allow-diverged to override (unsafe for real RC).`);
    }
  }

  info('Branch', branch);
  info('HEAD', head);
  if (originMain) info('origin/main', originMain);
  info('Flags', `${skipFullValidation ? '--skip-full-validation ' : ''}${keepTemp ? '--keep-temp ' : ''}${allowDiverged ? '--allow-diverged ' : ''}`.trim() || '(none)');

  try {
    // ═══════ PHASE 1: VALIDATION GATES ═══════
    heading('Validation gates');

    const validationPlan = getValidationPlan(isValidating);
    const { allValidationsPass, validationResults, smokeResults } = executeValidationPlan(
      validationPlan,
      (stepDef) => {
        let errorSummary = null;
        const passed = step(stepDef.command, () => {
          try {
            switch (stepDef.command) {
              case 'git diff --check HEAD':
                git('diff --check HEAD');
                break;
              case 'npm audit':
                runOutput('npm audit', { timeout: stepDef.timeout });
                break;
              case 'npm run validate:full':
                run('npm run validate:full', { timeout: stepDef.timeout });
                break;
              case 'npm run verify:installed':
                run('npm run verify:installed', { timeout: stepDef.timeout });
                break;
              case 'npm run validate:quick (--skip-full-validation)':
                run('npm run validate:quick', { timeout: stepDef.timeout });
                break;
              case 'npm run build (--skip-full-validation)':
                run('npm run build', { timeout: stepDef.timeout });
                break;
              default:
                throw new Error(`Unknown validation step: ${stepDef.command}`);
            }
          } catch (error) {
            errorSummary = summarizeStepError(error);
            throw error;
          }
        });
        return { passed, error: errorSummary };
      },
    );

    if (!allValidationsPass) {
      fail('Validation', 'One or more validation gates failed. Aborting.');
    }

    // ═══════ PHASE 2: CREATE ARTIFACT ═══════
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir  = customOutDir || path.join(DEFAULT_OUT, `${ts}-${shortHead}`);
    fs.mkdirSync(outDir, { recursive: true });

    heading('Package artifact');

    step('npm pack', () => {
      run(`npm pack --pack-destination "${outDir}"`, { timeout: 60_000 });
    });

    const tarballs = fs.readdirSync(outDir).filter(f => f.endsWith('.tgz'));
    if (tarballs.length === 0) {
      fail('Tarball', 'No tarball produced by npm pack');
    }
    if (tarballs.length > 1) {
      // Multiple tarballs — unexpected; log but use the first by name
      console.log(`  ${DIM}Multiple tarballs found: ${tarballs.join(', ')}${RESET}`);
    }

    const tarballName = tarballs[0];
    const tarballPath = path.join(outDir, tarballName);
    const stat        = fs.statSync(tarballPath);
    const sha         = sha256(tarballPath);

    info('Tarball', tarballName);
    info('Size', `${(stat.size / 1024).toFixed(1)} kB`);
    info('SHA-256', sha);

    // ═══════ PHASE 3: INSTALLED-PACKAGE SMOKE ═══════
    heading('Installed-package smoke');

    const tmpConsumer = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-rc-consumer-'));
    let installSmokeOk = true;

    try {
      step('npm init consumer', () => {
        run('npm init -y', { cwd: tmpConsumer, silent: true });
      });

      step('npm install tarball', () => {
        run(`npm install "${tarballPath}"`, { cwd: tmpConsumer, timeout: 120_000, silent: true });
      });

      const binPath = path.join(tmpConsumer, 'node_modules', '.bin', 'xurgo-atlas');
      const hasBin  = fs.existsSync(binPath);
      step('binary installed', () => {
        if (!hasBin) throw new Error(`binary not found at ${binPath}`);
      });
      installSmokeOk = installSmokeOk && hasBin;

      const consumerEnv = {
        ...process.env,
        XURGO_ATLAS_CONFIG_DIR: path.join(tmpConsumer, 'xa-config'),
        XURGO_ATLAS_DATA_DIR:   path.join(tmpConsumer, 'xa-data'),
      };

      // Helper: invoke the installed binary
      function xaCheck(stepLabel, args, expectContains) {
        const ok = step(stepLabel, () => {
          const out = runOutput(`"${binPath}" ${args}`, {
            env: consumerEnv, cwd: tmpConsumer,
          });
          if (expectContains && !out.includes(expectContains)) {
            throw new Error(`Expected output to contain "${expectContains}"`);
          }
        });
        installSmokeOk = installSmokeOk && ok;
        return ok;
      }

      xaCheck('xurgo-atlas --help',              '--help',              null);
      xaCheck('xurgo-atlas status --help',        'status --help',      null);
      xaCheck('xurgo-atlas mcp-config --help',    'mcp-config --help',   null);

      // mcp-config --json: validate valid JSON with expected structure
      step('xurgo-atlas mcp-config --json', () => {
        const out = runOutput(`"${binPath}" mcp-config --json`, { env: consumerEnv, cwd: tmpConsumer });
        let parsed;
        try { parsed = JSON.parse(out.trim()); } catch {
          throw new Error('mcp-config --json output is not valid JSON');
        }
        if (!parsed.mcpServers?.['xurgo-atlas']?.url) {
          throw new Error('mcpServers.xurgo-atlas.url missing in JSON output');
        }
      });

    } finally {
      // Clean up temp consumer unless --keep-temp
      if (!keepTemp) {
        const tmpdir = os.tmpdir();
        const base   = path.basename(tmpConsumer);
        const safe   = tmpConsumer.startsWith(tmpdir)
                    && tmpConsumer !== tmpdir
                    && base.startsWith('xa-rc-consumer-');
        if (safe) {
          try { fs.rmSync(tmpConsumer, { recursive: true, force: true }); }
          catch { /* best effort */ }
        }
      } else {
        console.log(`  ${DIM}Temp consumer preserved: ${tmpConsumer}${RESET}`);
      }
    }

    // ═══════ PHASE 4: WRITE ARTIFACT FILES ═══════
    heading('Artifact files');

    const artifactFiles = [
      tarballName,
      'SHA256SUMS.txt',
      'MANIFEST.json',
      'PRIVATE_RC_SUMMARY.md',
      'PRIVATE_REVIEWER_CHECKLIST.md',
      'REVIEWER_INSTALL_SMOKE.mjs',
      'package.json',
      '.npmrc',
    ];

    const manifest = {
      package_name:    'xurgo-atlas',
      package_version: '0.1.0',
      tarball:         tarballName,
      tarball_size:    stat.size,
      sha256:          sha,
      git_branch:      branch,
      git_head:        head,
      git_origin_main: originMain,
      created:         isoNow(),
      files:           artifactFiles,
      validations:     validationResults.map((result) => result.command),
      validation_results: validationResults,
      smoke_commands:  smokeResults.map((result) => result.command),
      smoke_results:   smokeResults,
      note: 'Private RC artifact — not a public release. No tag, no push, no npm publish.',
    };

    // MANIFEST.json
    const manifestPath = path.join(outDir, 'MANIFEST.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    step('MANIFEST.json', () => {
      if (!fs.existsSync(manifestPath)) throw new Error('MANIFEST.json not written');
    });

    // SHA256SUMS.txt
    const sumsPath = path.join(outDir, 'SHA256SUMS.txt');
    fs.writeFileSync(sumsPath, `${sha}  ${tarballName}\n`);
    step('SHA256SUMS.txt', () => {
      if (!fs.existsSync(sumsPath)) throw new Error('SHA256SUMS.txt not written');
    });

    // REVIEWER_INSTALL_SMOKE.mjs
    const reviewerScript = generateReviewerSmokeScript(tarballName);
    const reviewerPath   = path.join(outDir, 'REVIEWER_INSTALL_SMOKE.mjs');
    fs.writeFileSync(reviewerPath, reviewerScript);
    step('REVIEWER_INSTALL_SMOKE.mjs', () => {
      if (!fs.existsSync(reviewerPath)) throw new Error('REVIEWER_INSTALL_SMOKE.mjs not written');
      const content = fs.readFileSync(reviewerPath, 'utf-8');
      if (!content.includes(tarballName)) throw new Error('reviewer script missing tarball reference');
    });

    // package.json (bundle-level reviewer wrapper)
    const bundlePkgPath = path.join(outDir, 'package.json');
    fs.writeFileSync(bundlePkgPath, generateBundlePackageJson());
    step('package.json (bundle wrapper)', () => {
      if (!fs.existsSync(bundlePkgPath)) throw new Error('bundle package.json not written');
      const pkg = JSON.parse(fs.readFileSync(bundlePkgPath, 'utf-8'));
      if (pkg.private !== true) throw new Error('bundle package.json must be private');
    });

    // .npmrc (bundle-level safety)
    const npmrcPath = path.join(outDir, '.npmrc');
    fs.writeFileSync(npmrcPath, generateNpmrc());
    step('.npmrc', () => {
      if (!fs.existsSync(npmrcPath)) throw new Error('.npmrc not written');
      const content = fs.readFileSync(npmrcPath, 'utf-8');
      if (!content.includes('save=false')) throw new Error('.npmrc missing save=false');
    });

    // PRIVATE_RC_SUMMARY.md
    const summaryPath = path.join(outDir, 'PRIVATE_RC_SUMMARY.md');
    fs.writeFileSync(summaryPath, [
      `# Xurgo Atlas — Private RC Artifact`,
      ``,
      `- **Package:** \`${manifest.package_name}\` v${manifest.package_version}`,
      `- **Tarball:** \`${tarballName}\``,
      `- **SHA-256:** \`${sha}\``,
      `- **Git branch:** \`${branch}\``,
      `- **Git head:** \`${head}\``,
      originMain ? `- **origin/main:** \`${originMain}\`` : null,
      `- **Created:** ${manifest.created}`,
      ``,
      `## Validation`,
      ``,
      renderStepResults(validationResults),
      ``,
      `## Smoke`,
      ``,
      renderStepResults(smokeResults, '(skipped)'),
      ``,
            `## Installed-package smoke`,
      ``,
      installSmokeOk ? '- [x] PASS' : '- [ ] FAIL',
      ``,
      `## Bundle wrapper`,
      ``,
      `This bundle is a private/disposable reviewer workspace. It includes a`,
      `\`package.json\` (marked \`"private": true\`) and an \`.npmrc\` file so that`,
      `npm commands run inside this directory stay contained and do not climb`,
      `into the parent \`xurgo-atlas\` repo context.`,
      ``,
      `The actual package under review is the \`.tgz\` file in this directory.`,
      `All installs happen in an OS temp workspace, not in this bundle.`,
      ``,
      `You may copy this entire bundle folder outside the repo before running`,
      `the smoke script, but this is not required.`,
      ``,
      `## Reviewer smoke script`,
      ``,
      `This bundle includes \`REVIEWER_INSTALL_SMOKE.mjs\` — a standalone script`,
      `that automates tarball install and basic smoke testing in an isolated temp`,
      `workspace, and npm convenience scripts:`,
      ``,
      '```bash',
      'npm run smoke               # install + smoke + cleanup (via node script)',
      'npm run smoke:keep           # preserve temp workspace',
      'node REVIEWER_INSTALL_SMOKE.mjs       # direct invocation, no npm needed',
      'node REVIEWER_INSTALL_SMOKE.mjs --keep # preserve temp workspace',
      '```',
      `The script does NOT create any files in the artifact bundle directory.`,
      ``,
      `## Status`,


      ``,
      `This is a **private RC** artifact for internal testing only.`,
      `- No tag was created.`,
      `- No \`npm publish\` was run.`,
      `- No GitHub release was created.`,
      `- No push was performed.`,
      `- No package version was modified.`,
      ``,
      `Intended usage: copy the tarball to a private/internal test environment`,
      `for manual pre-release verification.`,
      ``,
    ].filter(Boolean).join('\n') + '\n');
    step('PRIVATE_RC_SUMMARY.md', () => {
      if (!fs.existsSync(summaryPath)) throw new Error('PRIVATE_RC_SUMMARY.md not written');
    });

    // PRIVATE_REVIEWER_CHECKLIST.md
    const checklistPath = path.join(outDir, 'PRIVATE_REVIEWER_CHECKLIST.md');
    fs.writeFileSync(checklistPath, [
      `# Private RC Reviewer Checklist`,
      ``,
      `**Package:** \`xurgo-atlas\` v0.1.0`,
      `**Tarball:** \`${tarballName}\``,
      `**SHA-256:** \`${sha}\``,
      ``,
      `This is a **private/internal RC test** — do not share publicly.`,
      ``,
      `## Prerequisites`,
      ``,
      `- Node.js >= 22`,
      `- npm`,
      `- Git`,
      `- An MCP-compatible client (e.g., opencode)`,
      ``,
      `## Bundle smoke (recommended first step)`,
      ``,
      '```bash',
      'cd <private-rc-bundle>',
      'npm run smoke',
      '```',
      ``,
      `Or, if you prefer direct invocation:`,
      ``,
      '```bash',
      'node REVIEWER_INSTALL_SMOKE.mjs',
      '```',
      ``,
      `Use \`npm run smoke:keep\` or \`node REVIEWER_INSTALL_SMOKE.mjs --keep\` to`,
      `preserve the temp workspace for inspection.`,
      ``,
      `The script creates a fresh temp consumer workspace, installs the tarball,`,
      `and runs basic smoke tests. It does NOT create any files in this bundle`,
      `directory.`,
      ``,
      `## Private RC bundle dummy-project reviewer workflow`,
      ``,
      `- **Source repo:** run \`npm run bundle:private-rc\` here, keep the tree`,
      `  clean, and do not use this checkout as the dummy consumer project.`,
      `- **Private RC bundle directory:** use`,
      `  \`artifacts/private-rc/<timestamp>-<short-head>/\` as the generated`,
      `  artifact bundle. It contains \`${tarballName}\`,`,
      `  \`PRIVATE_REVIEWER_CHECKLIST.md\`, \`REVIEWER_INSTALL_SMOKE.mjs\`,`,
      `  \`SHA256SUMS.txt\`, \`MANIFEST.json\`, \`PRIVATE_RC_SUMMARY.md\`, and`,
      `  related bundle files. Run bundle-local \`npm run smoke\` here.`,
      `  Do not treat this directory as the project being documented.`,
      `- **Dummy consumer project:** use a fresh isolated project, preferably`,
      `  under \`/tmp\`, install the tarball with`,
      `  \`npm install -D "$TARBALL"\`, and review \`npx xurgo-atlas\` help,`,
      `  init, list, status, daemon, and MCP behavior here.`,
      ``,
      `High-level command sequence:`,
      ``,
      '```sh',
      'BUNDLE_DIR="$(ls -td artifacts/private-rc/* | head -1)"',
      `TARBALL="$BUNDLE_DIR/${tarballName}"`,
      ``,
      'cd "$BUNDLE_DIR"',
      'npm run smoke',
      ``,
      'rm -rf /tmp/xurgo-atlas-rc-review',
      'mkdir -p /tmp/xurgo-atlas-rc-review/dummy-project',
      'cd /tmp/xurgo-atlas-rc-review/dummy-project',
      'git init -b main',
      'npm init -y',
      'npm install -D "$TARBALL"',
      'npx xurgo-atlas --help',
      'npx xurgo-atlas list',
      'npx xurgo-atlas init --template mcp-server --project-id dummy-rc-review',
      'npx xurgo-atlas list',
      'npx xurgo-atlas status',
      'npx xurgo-atlas daemon start',
      'npx xurgo-atlas mcp-config',
      '```',
      `- Expected pre-init \`list\` behavior: clear actionable error, no`,
      `  unhandled stack trace, and no \`GitConstructError\`.`,
      `- Project identity expectations: \`init\` writes a sticky local`,
      `  \`.xurgo-atlas/project.json\` marker, preserves it for the same`,
      `  project id, and fails clearly instead of overwriting it with a`,
      `  different project id. Project ids are globally unique in the`,
      `  registry.`,
      `- Expected daemon behavior after init: \`npx xurgo-atlas daemon start\``,
      `  works from the dummy project root without repeated flags, and`,
      `  mismatched explicit \`--project-id\` / \`--project-root\` values fail`,
      `  clearly instead of silently serving another project.`,
      `- Existing-doc preservation expectations: \`STATUS.md\`, \`AGENTS.md\`,`,
      `  and \`docs/manifest.yml\` are preserved; template init only creates`,
      `  missing docs.`,
      `- MCP/opencode verification expectations: verify through MCP tools`,
      `  only, do not read files directly from the filesystem for MCP`,
      `  verification, do not modify files, do not propose patches, and do not`,
      `  commit during reviewer verification.`,
      ``,
      `## Template guidance`,
      ``,
      `\`xurgo-atlas init\` supports documentation templates:`,
      ``,
      `- For a cloned repo that already has project docs, usually **omit \`--template\`**.`,
      `  Plain \`init --project-id <id>\` is the standard workflow.`,
      `- Use \`--template <name>\` for **new/empty projects** or when intentionally`,
      `  filling missing docs.`,
      `- **Existing docs are preserved by default.** Templates create missing files only.`,
      `  \`STATUS.md\`, \`AGENTS.md\`, and \`docs/manifest.yml\` stay in place.`,
      ``,
      `Available templates:`,
      ``,
      `| Template | Description |`,
      `|----------|-------------|`,
      `| \`default\` | Generic project with standard Atlas docs and project brief |`,
      `| \`saas\` | SaaS product with product brief, MVP scope, and dev workflow |`,
      `| \`cli-tool\` | CLI tool with command surface, packaging, and validation |`,
      `| \`mcp-server\` | MCP server with tool/resource surface and safety |`,
      `| \`web-app\` | Web app with product brief, routes, and frontend arch |`,
      ``,
      `List available templates:`,
      ``,
      '```bash',
      'xurgo-atlas init --templates',
      '```',
      ``,
      `## MCP / opencode verification`,
      ``,
      `> **Important:** Do not verify by reading files directly from the filesystem.`,
      `> Verify through MCP tools only.`,
      ``,
      `With the daemon running and an MCP client configured (see \`xurgo-atlas mcp-config\`),`,
      `connect to the Xurgo Atlas MCP server and run:`,
      ``,
      '```text',
      `Use the configured Xurgo Atlas MCP server.`,
      ``,
      `Do not verify by reading files directly from the filesystem. Verify through MCP tools only.`,
      ``,
      `Project id: <project-id>`,
      ``,
      `1. Call docs.list for this project.`,
      `2. Call docs.read for STATUS.md.`,
      `3. Call docs.read for AGENTS.md.`,
      `4. Call docs.read for docs/manifest.yml.`,
      `5. If available, call docs.context_pack.`,
      ``,
      `Report whether:`,
      `- the MCP server was reachable`,
      `- docs.list returned tracked docs`,
      `- docs.read returned STATUS.md content`,
      `- project id, branch, and revision metadata were returned`,
      ``,
      `Do not modify files. Do not propose patches. Do not commit.`,
      '```',
      `- [ ] MCP server was reachable`,
      `- [ ] \`docs.list\` returned tracked docs`,
      `- [ ] \`docs.read\` returned STATUS.md content`,
      `- [ ] Project id, branch, and revision metadata returned`,
      ``,
      `## About this bundle`,
      ``,
      `This bundle is a **private/disposable reviewer workspace**. The included`,
      `\`package.json\` is marked \`"private": true\` and exists solely to provide`,
      `safe npm convenience scripts and prevent npm from climbing into a parent`,
      `package context. It is NOT the product package. The product under review`,
      `is the \`.tgz\` file.`,
      ``,
      `You may copy this bundle folder outside the repo before testing, but this`,
      `is not required.`,
      ``,
      `## Report format`,
      ``,
      `If all checks pass, reply with a summary including:`,
      `- Environment (OS, Node version)`,
      `- Any configuration steps needed`,
      `- Confirmation all checks passed`,
      `- Which template (if any) was tested`,
      ``,
      `If any check fails, include:`,
      `- Exact command run`,
      `- Full error output`,
      `- Environment details`,
      ``,
    ].join('\n') + '\n');
    step('PRIVATE_REVIEWER_CHECKLIST.md', () => {
      if (!fs.existsSync(checklistPath)) throw new Error('PRIVATE_REVIEWER_CHECKLIST.md not written');
    });

    // ═══════ PHASE 5: FINAL STATUS CHECK ═══════
    heading('Final repo status');
    const finalStatus = git('status --short');
    const clean = !finalStatus;
    step('Working tree clean', () => {
      if (!clean) throw new Error(`Working tree dirty:\n${finalStatus}`);
    });

    // ═══════ REPORT ═══════
    console.log();
    console.log(`${BOLD}  Private RC artifact created${RESET}`);
    console.log(`  ${DIM}Output:${RESET} ${outDir}`);
    console.log(`  ${DIM}Tarball:${RESET} ${tarballPath}`);
    console.log(`  ${DIM}SHA-256:${RESET} ${sha}`);
    console.log();
    console.log(`  ${GREEN}✓${RESET} Validation passed`);
    console.log(`  ${GREEN}✓${RESET} Installed-package smoke ${installSmokeOk ? 'passed' : 'failed'}`);
    console.log(`  ${GREEN}✓${RESET} Artifact files written`);
    console.log(`  ${GREEN}✓${RESET} No public release actions taken`);
    console.log();

    if (!installSmokeOk) {
      console.error(`  ${RED}Installed-package smoke had failures.${RESET}`);
      console.error(`  Please inspect the artifact manually before distribution.`);
    }
    if (skipFullValidation) {
      console.log(`  ${DIM}Note: --skip-full-validation was used. Full validation was NOT run.${RESET}`);
    }
    if (allowDiverged) {
      console.log(`  ${DIM}Note: --allow-diverged was used. Local HEAD may not match origin/main.${RESET}`);
    }
    if (keepTemp) {
      console.log(`  ${DIM}Note: --keep-temp was used. Temp workspaces were preserved.${RESET}`);
    }
    console.log();

  } catch (e) {
    console.error(`\n${RED}UNEXPECTED ERROR${RESET}: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
