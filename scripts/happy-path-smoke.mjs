#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  Xurgo Atlas — Happy-Path Smoke Script
//
//  Builds, packs, and installs into an isolated consumer
//  workspace, then exercises the basic first-run flow against a
//  dummy SaaS project.
//
//  Usage:
//    node scripts/happy-path-smoke.mjs           # normal
//    node scripts/happy-path-smoke.mjs --keep    # preserve temp
//    node scripts/happy-path-smoke.mjs --port 47999
//    node scripts/happy-path-smoke.mjs --project-id smoke-foo
//
//  Flags:
//    --keep             preserve temp workspace on exit
//    --port <n>         daemon port (default 37878)
//    --project-id <id>  project ID  (default clientpulse-smoke)
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

// ─── Config ──────────────────────────────────────────────────
const PROJECT_NAME     = 'ClientPulse';
const DEFAULT_PORT     = 37878;
const DEFAULT_PROJECT  = 'clientpulse-smoke';
const DAEMON_HOST      = '127.0.0.1';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT       = path.resolve(__dirname, '..');

// Retry / health
const HEALTH_RETRIES     = 12;
const HEALTH_RETRY_MS    = 800;

// ─── State ───────────────────────────────────────────────────
let passCount  = 0;
let failCount  = 0;
let tmpRoot    = null;   // populated after mkdtemp
let keep       = false;
let port       = DEFAULT_PORT;
let projectId  = DEFAULT_PROJECT;

// global env with overrides — built after tmpRoot is known
let env = {};

// ─── Formatting ──────────────────────────────────────────────
const BOLD = '\x1b[1m';
const DIM  = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';

function heading(text) {
  const line = '─'.repeat(Math.min(text.length + 4, 72));
  console.log(`\n${line}\n  ${text}\n${line}`);
}

// ─── Step runner ─────────────────────────────────────────────
const printedResults = [];

function resultLine(label, ok, detail) {
  const mark  = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const extra = detail ? ` — ${DIM}${detail}${RESET}` : '';
  printedResults.push({ label, ok, detail });
  console.log(`  ${mark} ${label}${extra}`);
}

function syncStep(label, fn) {
  try {
    fn();
    resultLine(label, true);
  } catch (e) {
    const msg = e.message || String(e);
    resultLine(label, false, msg);
  }
}

async function asyncStep(label, fn) {
  try {
    await fn();
    resultLine(label, true);
  } catch (e) {
    const msg = e.message || String(e);
    resultLine(label, false, msg);
  }
}

// ─── Shell helpers ───────────────────────────────────────────
function run(cmd, opts = {}) {
  execSync(cmd, {
    cwd:       opts.cwd || REPO_ROOT,
    env:       opts.env || process.env,
    stdio:     'pipe',
    timeout:   opts.timeout || 120_000,
    encoding:  'utf-8',
  });
}

function runOutput(cmd, opts = {}) {
  return execSync(cmd, {
    cwd:       opts.cwd || REPO_ROOT,
    env:       opts.env || process.env,
    stdio:     'pipe',
    timeout:   opts.timeout || 30_000,
    encoding:  'utf-8',
    maxBuffer: 1024 * 1024,
  });
}

/** Invoke the installed xurgo-atlas binary with env-root overrides. */
function xa(args, opts = {}) {
  const bin = path.join(tmpRoot, 'consumer', 'node_modules', '.bin', 'xurgo-atlas');
  return runOutput(`"${bin}" ${args}`, {
    env: { ...env, ...(opts.env || {}) },
    ...opts,
  });
}

function xaCheck(label, args, contains, opts = {}) {
  syncStep(label, () => {
    const out = xa(args, opts);
    for (const c of [].concat(contains)) {
      if (!out.includes(c)) throw new Error(`expected "${c}" in output`);
    }
  });
}

// ─── HTTP helpers ────────────────────────────────────────────
/** Send an MCP JSON-RPC POST and return {status, body, text}. */
function mcpPost(method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
    const buf  = Buffer.from(body);
    const req  = http.request({
      hostname: DAEMON_HOST,
      port,
      path:     '/mcp',
      method:   'POST',
      headers: {
        'Content-Type':              'application/json',
        'Content-Length':            String(buf.length),
        'Accept':                    'application/json, text/event-stream',
        'MCP-Protocol-Version':      '2025-03-26',
      },
    }, (res) => {
      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text), text }); }
        catch { resolve({ status: res.statusCode, body: null, text }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

/** Send a GET request. */
function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: DAEMON_HOST, port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(text), text }); }
        catch { resolve({ status: res.statusCode, body: null, text }); }
      });
    }).on('error', reject);
  });
}

/** Send an OPTIONS request. */
function httpOptions(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: DAEMON_HOST,
      port,
      path:     urlPath,
      method:   'OPTIONS',
      headers:  { 'Access-Control-Request-Method': 'POST' },
    }, (res) => {
      // drain to avoid hanging
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Poll /health until it returns {status:"ok"} or throw. */
async function waitForHealthy() {
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    try {
      const r = await httpGet('/health');
      if (r.status === 200 && r.body?.status === 'ok') return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, HEALTH_RETRY_MS));
  }
  throw new Error(`/health not ok after ${HEALTH_RETRIES} tries`);
}

/** Parse SSE text, returning the first valid JSON payload found. */
function parseSSE(text) {
  const blocks = text.split('\n\n');
  for (const block of blocks) {
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) data += line.slice(6);
      else if (line.startsWith('data:')) data += line.slice(5);
    }
    if (data) {
      try { return JSON.parse(data); } catch { /* try next block */ }
    }
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  // ---- arg parse --------------------------------------------------
  const argv = process.argv.slice(2);
  keep      = argv.includes('--keep');
  const pi  = argv.indexOf('--port');
  if (pi !== -1 && argv[pi + 1]) port = parseInt(argv[pi + 1], 10);
  const pi2 = argv.indexOf('--project-id');
  if (pi2 !== -1 && argv[pi2 + 1]) projectId = argv[pi2 + 1];

  // ---- temp workspace ---------------------------------------------
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-smoke-'));
  const configDir    = path.join(tmpRoot, 'config');
  const dataDir      = path.join(tmpRoot, 'data');
  const pkgDir       = path.join(tmpRoot, 'pkg');
  const consumerDir  = path.join(tmpRoot, 'consumer');
  const projectDir   = path.join(tmpRoot, projectId);

  [configDir, dataDir, pkgDir, consumerDir, projectDir]
    .forEach(d => fs.mkdirSync(d, { recursive: true }));

  // env with overrides — all child commands pick this up
  env = { ...process.env, XURGO_ATLAS_CONFIG_DIR: configDir, XURGO_ATLAS_DATA_DIR: dataDir };

  const xaBin = path.join(consumerDir, 'node_modules', '.bin', 'xurgo-atlas');

  console.log(`${BOLD}Xurgo Atlas — Happy-Path Smoke Test${RESET}\n`);
  console.log(`${DIM}  Temp workspace :${RESET} ${tmpRoot}`);
  console.log(`${DIM}  Config dir     :${RESET} ${configDir}`);
  console.log(`${DIM}  Data dir       :${RESET} ${dataDir}`);
  console.log(`${DIM}  Daemon port    :${RESET} ${port}`);
  console.log(`${DIM}  Project ID     :${RESET} ${projectId}`);
  console.log(`${DIM}  Project name   :${RESET} ${PROJECT_NAME}\n`);

  try {
    // ═══════════ 1. BUILD & PACK ═══════════
    heading('Build & Pack');
    syncStep('npm run build', () => run('npm run build'));
    syncStep('npm pack', () => run(`npm pack --pack-destination "${pkgDir}"`));

    const tarballs = fs.readdirSync(pkgDir).filter(f => f.endsWith('.tgz'));
    if (!tarballs.length) throw new Error('no tarball produced');
    const tarball = path.join(pkgDir, tarballs[0]);
    console.log(`  ${DIM}Package: ${tarball}${RESET}\n`);

    // ═══════════ 2. CONSUMER WORKSPACE ═══════════
    heading('Consumer workspace');

    syncStep('npm init consumer', () => {
      run('npm init -y', { cwd: consumerDir });
    });
    syncStep('npm install tarball', () => {
      run(`npm install "${tarball}"`, { cwd: consumerDir, timeout: 120_000 });
    });
    syncStep('binary exists', () => {
      if (!fs.existsSync(xaBin)) throw new Error(`binary not found at ${xaBin}`);
    });

    // ═══════════ 3. DUMMY PROJECT ═══════════
    heading('Dummy project');

    syncStep('create project files', () => {
      fs.writeFileSync(path.join(projectDir, 'STATUS.md'),
        `# Project Status\n\n${PROJECT_NAME} is under active development.\n`);
      fs.writeFileSync(path.join(projectDir, 'AGENTS.md'),
        `# Agent Instructions for ${PROJECT_NAME}\n\nAlways be helpful.\n`);
      const dd = path.join(projectDir, 'docs');
      fs.mkdirSync(dd, { recursive: true });
      fs.writeFileSync(path.join(dd, 'manifest.yml'), `# ${PROJECT_NAME} doc manifest\n`);
      fs.writeFileSync(path.join(dd, 'product-brief.md'),
        `# ${PROJECT_NAME}\n\nA fictional SaaS for smoke testing.\n`);
    });
    syncStep('git init & commit', () => {
      run('git init',     { cwd: projectDir });
      run('git config user.email "smoke@test.local"',  { cwd: projectDir });
      run('git config user.name "Smoke Test"',         { cwd: projectDir });
      run('git add -A && git commit -m "initial docs"', { cwd: projectDir });
    });

    // ═══════════ 4. CLI HELP ═══════════
    heading('CLI help');
    xaCheck('xurgo-atlas --help',          '--help',          'USAGE');
    xaCheck('xurgo-atlas init --help',      'init --help',     'USAGE');
    xaCheck('xurgo-atlas daemon --help',   'daemon --help',   'USAGE');
    xaCheck('xurgo-atlas status --help',   'status --help',   'USAGE');
    xaCheck('xurgo-atlas mcp-config --help','mcp-config --help','USAGE');

    // ═══════════ 5. INIT ──────────────────────────────────────
    heading('xurgo-atlas init');
    syncStep('init', () => {
      const out = xa(`init --project-id "${projectId}" --project-root "${projectDir}"`);
      if (!out.includes('successfully')) throw new Error('init did not report success');
    });
    xaCheck('project list', 'project list', projectId);
    xaCheck('docs list', `list --project-root "${projectDir}"`, ['projectId', 'branch', 'files']);

    // ═══════════ 6. STATUS (no daemon) ────────────────────────
    heading('Pre-daemon checks');
    xaCheck('xurgo-atlas status', 'status', ['Xurgo Atlas setup status', 'not running']);

    // ═══════════ 7. MCP CONFIG ────────────────────────────────
    heading('MCP config');
    xaCheck('mcp-config', 'mcp-config', ['MCP', 'configuration']);
    syncStep('mcp-config --json', () => {
      const out = xa('mcp-config --json');
      // should be standalone JSON
      let parsed;
      try { parsed = JSON.parse(out.trim()); } catch { throw new Error('mcp-config --json is not valid JSON'); }
      if (!parsed.mcpServers?.['xurgo-atlas']?.url) throw new Error('mcpServers.xurgo-atlas.url missing');
    });

    // ═══════════ 8. DAEMON ────────────────────────────────────
    heading('Daemon');

    syncStep('daemon start', () => {
      const out = xa(`daemon start --host ${DAEMON_HOST} --port ${port}`);
      if (!out.includes('Started') && !out.includes('already running')) {
        throw new Error('daemon did not start');
      }
    });

    xaCheck('daemon status', 'daemon status', ['running', String(port)]);

    // ═══════════ 9. HTTP / HEALTH ─────────────────────────────
    heading('HTTP & MCP checks');

    await asyncStep('GET /health → {status:"ok"}', async () => {
      await waitForHealthy();
    });

    await asyncStep('OPTIONS /mcp → 204', async () => {
      const r = await httpOptions('/mcp');
      // some frameworks return 200 or 204; accept both
      if (r.status !== 204 && r.status !== 200) {
        throw new Error(`expected 204, got ${r.status}`);
      }
    });

    // ═══════════ 10. MCP JSON-RPC ─────────────────────────────
    await asyncStep('tools/list returns docs.list + docs.read', async () => {
      const r = await mcpPost('tools/list', {}, 1);
      if (r.status !== 200) {
        throw new Error(`status ${r.status} — ${r.text.slice(0, 300)}`);
      }

      // Handle SSE wrapping if present
      let result = r.body?.result;
      if (!result) {
        const parsed = parseSSE(r.text);
        if (!parsed?.result) throw new Error('tools/list response has no result');
        result = parsed.result;
      }

      const names = (result.tools || []).map(t => t.name);
      if (!names.includes('docs.list')) throw new Error('docs.list missing');
      if (!names.includes('docs.read')) throw new Error('docs.read missing');
    });

    await asyncStep('docs.list via tools/call', async () => {
      const r  = await mcpPost('tools/call', { name: 'docs.list', arguments: { projectId } }, 2);
      if (r.status !== 200) throw new Error(`status ${r.status}`);

      let result = r.body?.result;
      if (!result) {
        const parsed = parseSSE(r.text);
        if (!parsed?.result) throw new Error('docs.list no result');
        result = parsed.result;
      }
      if (!result.content) throw new Error('docs.list result missing content');
      const text = typeof result.content === 'string'
        ? result.content
        : Array.isArray(result.content)
          ? result.content.map(c => c.text || '').join('')
          : JSON.stringify(result);
      if (!text.includes(projectId) && !text.includes('docs')) {
        throw new Error('docs.list content unexpected');
      }
    });

    await asyncStep('docs.read STATUS.md', async () => {
      const r  = await mcpPost('tools/call', {
        name: 'docs.read',
        arguments: { projectId, path: 'STATUS.md' },
      }, 3);
      if (r.status !== 200) throw new Error(`status ${r.status}`);

      let result = r.body?.result;
      if (!result) {
        const parsed = parseSSE(r.text);
        if (!parsed?.result) throw new Error('docs.read no result');
        result = parsed.result;
      }
      const content = typeof result.content === 'string'
        ? result.content
        : Array.isArray(result.content)
          ? result.content.map(c => c.text || '').join('')
          : JSON.stringify(result);
      if (!content.includes(PROJECT_NAME) && !content.includes('Project Status') && !content.includes('STATUS.md')) {
        throw new Error('docs.read content missing expected text');
      }
    });

  } finally {
    // ═══════════ 11. CLEANUP ──────────────────────────────────
    console.log();
    heading('Cleanup');

    // Always attempt daemon stop
    syncStep('stop daemon', () => {
      try { xa('daemon stop', { timeout: 10_000 }); } catch { /* already stopped */ }
    });

    // ═══════════ 12. REPORT ───────────────────────────────────
    console.log();
    heading('Result');

    const total  = passCount + failCount;
    const passed = failCount === 0;

    // recalc counts from printedResults
    passCount = printedResults.filter(r => r.ok).length;
    failCount = printedResults.filter(r => !r.ok).length;

    // re-print results block
    for (const r of printedResults) {
      const mark  = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const extra = r.detail ? ` — ${DIM}${r.detail}${RESET}` : '';
      console.log(`  ${mark} ${r.label}${extra}`);
    }

    console.log(`\n${BOLD}  ${passCount}/${total} passed, ${failCount} failed${RESET}`);
    console.log(`${BOLD}  Verdict: ${passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}${RESET}`);
    console.log();

    // Info block
    console.log(`${DIM}package:      ${path.join(tmpRoot, 'pkg')}/*.tgz${RESET}`);
    console.log(`${DIM}workspace:    ${tmpRoot}${RESET}`);
    console.log(`${DIM}project:      ${projectDir}${RESET}`);
    console.log(`${DIM}config dir:   ${configDir}${RESET}`);
    console.log(`${DIM}data dir:     ${dataDir}${RESET}`);
    console.log(`${DIM}daemon port:  ${port}${RESET}`);
    console.log(`${DIM}result:       ${passed ? 'PASS' : 'FAIL'}${RESET}`);
    console.log();

    // Exit code
    if (!passed) process.exitCode = 1;

    // Temp cleanup — only if --keep not set
    if (!keep) {
      // Defensive: never delete a path we didn't create
      const tmpdir = os.tmpdir();
      const base   = tmpRoot ? path.basename(tmpRoot) : '';
      const safe   = tmpRoot
        && tmpRoot.startsWith(tmpdir)
        && tmpRoot !== tmpdir
        && base.startsWith('xa-smoke-');
      if (!safe) {
        console.error(`${RED}Refusing to rm -rf path that does not look like` +
          ` the smoke temp workspace: ${tmpRoot}${RESET}`);
      } else {
        try {
          fs.rmSync(tmpRoot, { recursive: true, force: true });
          console.log(`${DIM}Temp workspace cleaned up.${RESET}`);
        } catch (e) {
          console.error(`${DIM}Cleanup warning: ${e.message}${RESET}`);
        }
      }
    } else {
      console.log(`${DIM}Temp workspace preserved: ${tmpRoot}${RESET}`);
    }
    console.log();
  }
}

main().catch(e => {
  console.error(`\n${RED}UNEXPECTED ERROR${RESET}: ${e.message}`);
  process.exitCode = 1;
});
