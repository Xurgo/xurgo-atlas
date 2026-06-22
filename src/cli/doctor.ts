import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitStore } from '../core/git-store.js';
import { buildRootLedgerIdentityKey } from '../core/root-ledger.js';
import {
  readExistingRootLedgerSummary,
  readRecoveryEvidence,
} from '../core/read-only-managed-state.js';
import { StoragePaths, type StorageConfig, resolveStorageRoots } from '../core/storage.js';

const execFileAsync = promisify(execFile);

export type DoctorSeverity = 'ok' | 'warn' | 'unsafe' | 'unknown';

export interface DoctorOptions extends StorageConfig {
  cwd?: string;
  json?: boolean;
}

export interface DoctorSnapshot {
  generatedAt: string;
  severity: DoctorSeverity;
  repo: {
    root: string | null;
    packageName: string | null;
    originUrl: string | null;
    branch: string | null;
    head: string | null;
    gitAvailable: boolean;
    workingTreeClean: boolean | null;
    workingTreeStatus: DoctorSeverity;
  };
  runtime: {
    severity: DoctorSeverity;
    nodeVersion: string;
    npmVersion: string | null;
    npmAvailable: boolean;
    engineRange: string | null;
    nodeSatisfiesEngine: boolean | null;
  };
  project: {
    severity: DoctorSeverity;
    requestedCwd: string;
    projectRoot: string | null;
    canonicalProjectRoot: string | null;
    projectId: string | null;
    marker: {
      present: boolean;
      path: string | null;
      projectId: string | null;
      parseError: string | null;
    };
    registry: {
      available: boolean;
      path: string;
      defaultProjectId: string | null;
      matchedProjectId: string | null;
      matchedProjectRoot: string | null;
      exactRootMatch: boolean | null;
      readError: string | null;
    };
    git: {
      available: boolean;
      worktreeRoot: string | null;
      commonDir: string | null;
      branch: string | null;
      head: string | null;
    };
    safety: {
      safeForWrites: boolean | null;
      ambiguous: boolean | null;
      rootMismatch: boolean | null;
      markerMissing: boolean;
      markerMismatch: boolean;
      registeredProjectRootMissing: boolean;
      registeredProjectRootMismatch: boolean;
      gitMismatch: boolean;
      gitUnavailable: boolean;
      warnings: string[];
    };
    rootLedger: {
      available: boolean;
      severity: DoctorSeverity;
      knownObservationCount: number | null;
      currentObservationCount: number | null;
      distinctCanonicalProjectRootCount: number | null;
      distinctGitWorktreeRootCount: number | null;
      distinctGitCommonDirCount: number | null;
      lastObservedAt: string | null;
      warnings: string[];
    };
  };
  daemon: {
    severity: DoctorSeverity;
    running: boolean | null;
    stalePidFile: boolean;
    endpoint: string | null;
    projectId: string | null;
    projectRoot: string | null;
    readError: string | null;
  };
  managedDocs: {
    severity: DoctorSeverity;
    available: boolean;
    managedRepoPath: string | null;
    managedBranch: string | null;
    sourceBranch: string | null;
    exportRequired: boolean | null;
    workingTreeOutOfSync: boolean | null;
    ownedPathCount: number | null;
    outOfSyncPaths: string[];
    unavailableReason: string | null;
  };
  recovery: {
    severity: DoctorSeverity;
    available: boolean;
    pendingProposalCount: number | null;
    pendingCurrentRootProposalCount: number | null;
    pendingForeignRootProposalCount: number | null;
    pendingUnknownRootProposalCount: number | null;
    lastPreviewExportObservation: DoctorRecoveryObservation | null;
    lastExportObservation: DoctorRecoveryObservation | null;
    warnings: string[];
    unavailableReason: string | null;
  };
  nextSteps: string[];
}

export interface DoctorRecoveryObservation {
  branch: string | null;
  createdAt: string | null;
  safeForWrites: boolean | null;
  rootUnsafe: boolean | null;
  exportRequired: boolean | null;
  exportBlocked: boolean | null;
  warningCount: number | null;
}

interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface RegistrySnapshot {
  available: boolean;
  path: string;
  defaultProjectId: string | null;
  matchedProjectId: string | null;
  matchedProjectRoot: string | null;
  exactRootMatch: boolean | null;
  readError: string | null;
}

interface RootLedgerSnapshot {
  available: boolean;
  severity: DoctorSeverity;
  knownObservationCount: number | null;
  currentObservationCount: number | null;
  distinctCanonicalProjectRootCount: number | null;
  distinctGitWorktreeRootCount: number | null;
  distinctGitCommonDirCount: number | null;
  lastObservedAt: string | null;
  warnings: string[];
}

export function getDoctorUsageText(): string {
  return `
Show a bounded Xurgo Atlas diagnostic snapshot.

USAGE:
  xurgo-atlas doctor [options]

OPTIONS:
  --json                Print output as machine-readable JSON only
  --config-dir <path>   Config directory (default: ~/.config/xurgo-atlas;
                        overrides XURGO_ATLAS_CONFIG_DIR; legacy roots
                        auto-discovered)
  --data-dir <path>     Data directory (default: ~/.local/share/xurgo-atlas;
                        overrides XURGO_ATLAS_DATA_DIR; legacy roots
                        auto-discovered)

This command is strictly read-only. It does not write files, refresh Atlas
metadata, start or stop the daemon, or modify managed state.

EXAMPLES:
  xurgo-atlas doctor
  xurgo-atlas doctor --json
`;
}

export function printDoctorUsage(): void {
  console.log(getDoctorUsageText());
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const snapshot = await buildDoctorSnapshot(options);
  console.log(options.json ? JSON.stringify(snapshot, null, 2) : renderDoctorSnapshot(snapshot));
}

export async function buildDoctorSnapshot(options: DoctorOptions = {}): Promise<DoctorSnapshot> {
  const requestedCwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = await resolveRepoRoot(requestedCwd);
  const packageName = repoRoot ? await readPackageName(repoRoot) : null;
  const originUrl = repoRoot ? await readGitValue(repoRoot, ['remote', 'get-url', 'origin']) : null;
  const branch = repoRoot ? await readCurrentBranch(repoRoot) : null;
  const head = repoRoot ? await readGitValue(repoRoot, ['rev-parse', 'HEAD']) : null;
  const gitWorktreeRoot = repoRoot ? await readGitValue(repoRoot, ['rev-parse', '--show-toplevel']) : null;
  const gitCommonDirRaw = repoRoot ? await readGitValue(repoRoot, ['rev-parse', '--git-common-dir']) : null;
  const gitCommonDir = repoRoot ? normalizeGitPath(gitCommonDirRaw, repoRoot) : null;
  const workingTreeClean = repoRoot ? await inspectWorkingTreeClean(repoRoot) : null;
  const engineRange = repoRoot ? await readNodeEngineRange(repoRoot) : null;
  const npmVersion = await readToolVersion('npm');

  const storageRoots = resolveStorageRoots({
    configDir: options.configDir,
    dataDir: options.dataDir,
  });
  const storage = new StoragePaths({
    configDir: storageRoots.configDir,
    dataDir: storageRoots.dataDir,
  });

  const projectRoot = repoRoot ?? null;
  const canonicalProjectRoot = projectRoot ? normalizePath(projectRoot) : null;
  const marker = projectRoot ? await readProjectMarker(projectRoot) : {
    present: false,
    path: null,
    projectId: null,
    parseError: null,
  };

  const registry = canonicalProjectRoot
    ? await readRegistrySnapshot(storage.registryPath(), canonicalProjectRoot, marker.projectId)
    : {
        available: false,
        path: storage.registryPath(),
        defaultProjectId: null,
        matchedProjectId: null,
        matchedProjectRoot: null,
        exactRootMatch: null,
        readError: 'project root unavailable',
      };

  const resolvedProjectId = marker.projectId ?? registry.matchedProjectId ?? null;
  const rootMismatchSignals = canonicalProjectRoot
    ? inspectRootSafety({
        projectId: resolvedProjectId,
        canonicalProjectRoot,
        markerProjectId: marker.projectId,
        registeredProjectRoot: registry.matchedProjectRoot,
        gitWorktreeRoot,
      })
    : unknownRootSafety();

  const daemon = readDaemonStatus(storage.daemonPidFilePath());
  const rootLedger = resolvedProjectId && canonicalProjectRoot
    ? await readRootLedgerSnapshot(storage.projectEventsPath(resolvedProjectId), {
        projectId: resolvedProjectId,
        canonicalProjectRoot,
        registeredProjectRoot: registry.matchedProjectRoot,
        daemonProjectRoot: null,
        markerProjectId: marker.projectId,
        markerRootPath: marker.present && marker.path ? path.dirname(path.dirname(marker.path)) : null,
        gitWorktreeRoot,
        gitCommonDir,
      })
    : unavailableRootLedgerSnapshot('project identity unavailable');

  const managedDocs = resolvedProjectId && projectRoot
    ? await readManagedDocsSnapshot({
        projectId: resolvedProjectId,
        projectRoot,
        storage,
        sourceBranch: branch,
      })
    : {
        severity: 'unknown' as const,
        available: false,
        managedRepoPath: null,
        managedBranch: null,
        sourceBranch: branch,
        exportRequired: null,
        workingTreeOutOfSync: null,
        ownedPathCount: null,
        outOfSyncPaths: [],
        unavailableReason: 'project identity unavailable',
      };

  const recovery = resolvedProjectId && canonicalProjectRoot
    ? await readRecoverySnapshot(storage.projectEventsPath(resolvedProjectId), {
        projectId: resolvedProjectId,
        canonicalProjectRoot,
        registeredProjectRoot: registry.matchedProjectRoot,
        daemonProjectRoot: null,
        markerProjectId: marker.projectId,
        markerRootPath: marker.present && marker.path ? path.dirname(path.dirname(marker.path)) : null,
        gitWorktreeRoot,
        gitCommonDir,
      })
    : unavailableRecoverySnapshot('project identity unavailable');

  const projectSeverity = deriveProjectSeverity(rootMismatchSignals);
  const runtimeSeverity = deriveRuntimeSeverity(engineRange, npmVersion);
  const daemonSeverity = deriveDaemonSeverity(daemon.running, daemon.stalePidFile, daemon.readError);
  const nextSteps = buildNextSteps({
    projectSeverity,
    daemonSeverity,
    managedDocsSeverity: managedDocs.severity,
    recoverySeverity: recovery.severity,
    workingTreeClean,
    managedDocs,
    recovery,
  });

  const snapshot: DoctorSnapshot = {
    generatedAt: new Date().toISOString(),
    severity: foldSeverities([
      workingTreeClean === null ? 'unknown' : workingTreeClean ? 'ok' : 'warn',
      runtimeSeverity,
      projectSeverity,
      daemonSeverity,
      managedDocs.severity,
      recovery.severity,
    ]),
    repo: {
      root: repoRoot,
      packageName,
      originUrl,
      branch,
      head,
      gitAvailable: repoRoot !== null,
      workingTreeClean,
      workingTreeStatus: workingTreeClean === null ? 'unknown' : workingTreeClean ? 'ok' : 'warn',
    },
    runtime: {
      severity: runtimeSeverity,
      nodeVersion: process.version,
      npmVersion,
      npmAvailable: npmVersion !== null,
      engineRange,
      nodeSatisfiesEngine: engineRange ? checkNodeEngineSatisfaction(process.version, engineRange) : null,
    },
    project: {
      severity: projectSeverity,
      requestedCwd,
      projectRoot,
      canonicalProjectRoot,
      projectId: resolvedProjectId,
      marker,
      registry,
      git: {
        available: gitWorktreeRoot !== null,
        worktreeRoot: gitWorktreeRoot,
        commonDir: gitCommonDir,
        branch,
        head,
      },
      safety: rootMismatchSignals,
      rootLedger,
    },
    daemon: {
      severity: daemonSeverity,
      running: daemon.running,
      stalePidFile: daemon.stalePidFile,
      endpoint: daemon.endpoint,
      projectId: daemon.projectId,
      projectRoot: daemon.projectRoot,
      readError: daemon.readError,
    },
    managedDocs,
    recovery,
    nextSteps,
  };

  return snapshot;
}

export function renderDoctorSnapshot(snapshot: DoctorSnapshot): string {
  const lines: string[] = [];

  lines.push('Xurgo Atlas doctor');
  lines.push(`Overall: ${snapshot.severity}`);
  lines.push('');

  lines.push(`Repository [${snapshot.repo.workingTreeStatus}]`);
  lines.push(`  root: ${snapshot.repo.root ?? 'unknown'}`);
  lines.push(`  package: ${snapshot.repo.packageName ?? 'unknown'}`);
  lines.push(`  branch: ${snapshot.repo.branch ?? 'unknown'}`);
  lines.push(`  HEAD: ${snapshot.repo.head ?? 'unknown'}`);
  lines.push(`  remote: ${snapshot.repo.originUrl ?? 'unknown'}`);
  lines.push(`  working tree: ${formatBoolean(snapshot.repo.workingTreeClean, 'clean', 'dirty')}`);
  lines.push('');

  lines.push(`Project safety [${snapshot.project.severity}]`);
  lines.push(`  project id: ${snapshot.project.projectId ?? 'unknown'}`);
  lines.push(`  marker: ${snapshot.project.marker.present ? 'present' : 'missing'}`);
  lines.push(`  safe for writes: ${formatBoolean(snapshot.project.safety.safeForWrites, 'yes', 'no')}`);
  if (snapshot.project.safety.warnings.length > 0) {
    lines.push(`  warnings: ${snapshot.project.safety.warnings.join('; ')}`);
  }
  if (snapshot.project.rootLedger.available) {
    lines.push(
      `  root ledger: ${snapshot.project.rootLedger.knownObservationCount ?? 'unknown'} known observation(s)`,
    );
  } else if (snapshot.project.rootLedger.warnings.length > 0) {
    lines.push(`  root ledger: ${snapshot.project.rootLedger.warnings[0]}`);
  }
  lines.push('');

  lines.push(`Runtime [${snapshot.runtime.severity}]`);
  lines.push(`  node: ${snapshot.runtime.nodeVersion}`);
  lines.push(`  npm: ${snapshot.runtime.npmVersion ?? 'unknown'}`);
  lines.push(`  engine: ${snapshot.runtime.engineRange ?? 'unknown'}`);
  lines.push(
    `  engine satisfied: ${formatBoolean(snapshot.runtime.nodeSatisfiesEngine, 'yes', 'no')}`,
  );
  lines.push('');

  lines.push(`Daemon [${snapshot.daemon.severity}]`);
  lines.push(`  running: ${formatBoolean(snapshot.daemon.running, 'yes', 'no')}`);
  lines.push(`  endpoint: ${snapshot.daemon.endpoint ?? 'unknown'}`);
  lines.push('');

  lines.push(`Managed docs [${snapshot.managedDocs.severity}]`);
  lines.push(`  branch: ${snapshot.managedDocs.managedBranch ?? 'unknown'}`);
  lines.push(
    `  export required: ${formatBoolean(snapshot.managedDocs.exportRequired, 'yes', 'no')}`,
  );
  lines.push(
    `  out of sync paths: ${snapshot.managedDocs.outOfSyncPaths.length > 0 ? snapshot.managedDocs.outOfSyncPaths.join(', ') : 'none'}`,
  );
  if (snapshot.managedDocs.unavailableReason) {
    lines.push(`  note: ${snapshot.managedDocs.unavailableReason}`);
  }
  lines.push('');

  lines.push(`Recovery [${snapshot.recovery.severity}]`);
  lines.push(
    `  pending proposals: ${snapshot.recovery.pendingProposalCount ?? 'unknown'}`,
  );
  if (snapshot.recovery.lastPreviewExportObservation) {
    lines.push(
      `  last preview observation: ${snapshot.recovery.lastPreviewExportObservation.createdAt ?? 'unknown'}`,
    );
  }
  if (snapshot.recovery.warnings.length > 0) {
    lines.push(`  warnings: ${snapshot.recovery.warnings.join('; ')}`);
  }
  lines.push('');

  lines.push('Next steps');
  for (const step of snapshot.nextSteps) {
    lines.push(`  - ${step}`);
  }

  return lines.join('\n');
}

async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  return result.ok ? normalizePath(result.stdout.trim()) : null;
}

async function readGitValue(cwd: string, args: string[]): Promise<string | null> {
  const result = await runCommand('git', args, cwd);
  if (!result.ok) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

async function readCurrentBranch(cwd: string): Promise<string | null> {
  const result = await runCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (!result.ok) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}

async function inspectWorkingTreeClean(cwd: string): Promise<boolean | null> {
  const unstaged = await runCommand('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD', '--'], cwd);
  const staged = await runCommand('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--'], cwd);
  const untracked = await runCommand('git', ['ls-files', '--others', '--exclude-standard'], cwd);

  if (!untracked.ok) {
    return null;
  }

  if ((unstaged.exitCode !== 0 && unstaged.exitCode !== 1) || (staged.exitCode !== 0 && staged.exitCode !== 1)) {
    return null;
  }

  return unstaged.exitCode === 0 && staged.exitCode === 0 && untracked.stdout.trim().length === 0;
}

async function readPackageName(repoRoot: string): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(path.join(repoRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}

async function readNodeEngineRange(repoRoot: string): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(path.join(repoRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { engines?: { node?: unknown } };
    return typeof parsed.engines?.node === 'string' ? parsed.engines.node : null;
  } catch {
    return null;
  }
}

async function readToolVersion(tool: string): Promise<string | null> {
  const result = await runCommand(tool, ['--version'], process.cwd());
  if (!result.ok) {
    return null;
  }

  const version = result.stdout.trim();
  return version.length > 0 ? version : null;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function normalizeGitPath(gitPath: string | null, cwd: string): string | null {
  if (!gitPath) {
    return null;
  }

  return normalizePath(path.isAbsolute(gitPath) ? gitPath : path.resolve(cwd, gitPath));
}

function normalizePath(input: string): string {
  try {
    return fs.realpathSync.native(input);
  } catch {
    return path.resolve(input);
  }
}

async function readProjectMarker(projectRoot: string): Promise<DoctorSnapshot['project']['marker']> {
  const markerPath = path.join(projectRoot, '.xurgo-atlas', 'project.json');
  try {
    const raw = await fs.promises.readFile(markerPath, 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: unknown };
    return {
      present: true,
      path: markerPath,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      parseError: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        present: false,
        path: markerPath,
        projectId: null,
        parseError: null,
      };
    }

    return {
      present: true,
      path: markerPath,
      projectId: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readRegistrySnapshot(
  registryPath: string,
  canonicalProjectRoot: string,
  markerProjectId: string | null,
): Promise<RegistrySnapshot> {
  try {
    const raw = await fs.promises.readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      defaultProjectId?: unknown;
      projects?: Record<string, { projectRoot?: unknown }>;
    };
    const projects = parsed.projects && typeof parsed.projects === 'object'
      ? parsed.projects
      : {};

    let matchedProjectId: string | null = null;
    let matchedProjectRoot: string | null = null;
    let exactRootMatch: boolean | null = false;

    if (markerProjectId && projects[markerProjectId]?.projectRoot && typeof projects[markerProjectId].projectRoot === 'string') {
      matchedProjectId = markerProjectId;
      matchedProjectRoot = normalizePath(projects[markerProjectId].projectRoot as string);
      exactRootMatch = comparePaths(matchedProjectRoot, canonicalProjectRoot);
    } else {
      for (const [projectId, entry] of Object.entries(projects)) {
        if (typeof entry?.projectRoot !== 'string') {
          continue;
        }
        const normalizedRoot = normalizePath(entry.projectRoot);
        if (comparePaths(normalizedRoot, canonicalProjectRoot)) {
          matchedProjectId = projectId;
          matchedProjectRoot = normalizedRoot;
          exactRootMatch = true;
          break;
        }
      }
    }

    return {
      available: true,
      path: registryPath,
      defaultProjectId: typeof parsed.defaultProjectId === 'string' ? parsed.defaultProjectId : null,
      matchedProjectId,
      matchedProjectRoot,
      exactRootMatch,
      readError: null,
    };
  } catch (error) {
    return {
      available: false,
      path: registryPath,
      defaultProjectId: null,
      matchedProjectId: null,
      matchedProjectRoot: null,
      exactRootMatch: null,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectRootSafety(input: {
  projectId: string | null;
  canonicalProjectRoot: string;
  markerProjectId: string | null;
  registeredProjectRoot: string | null;
  gitWorktreeRoot: string | null;
}): DoctorSnapshot['project']['safety'] {
  const markerMissing = input.markerProjectId === null;
  const markerMismatch = Boolean(input.projectId && input.markerProjectId && input.markerProjectId !== input.projectId);
  const registeredProjectRootMissing = input.registeredProjectRoot === null;
  const registeredProjectRootMismatch = Boolean(
    input.registeredProjectRoot && !comparePaths(input.registeredProjectRoot, input.canonicalProjectRoot),
  );
  const gitUnavailable = input.gitWorktreeRoot === null;
  const gitMismatch = Boolean(
    input.gitWorktreeRoot && !comparePaths(input.gitWorktreeRoot, input.canonicalProjectRoot),
  );
  const rootMismatch = markerMismatch || registeredProjectRootMismatch || gitMismatch;
  const safeForWrites = !markerMissing && !markerMismatch && !registeredProjectRootMissing && !registeredProjectRootMismatch && !gitMismatch;
  const warnings = buildSafetyWarnings({
    markerMissing,
    markerMismatch,
    registeredProjectRootMissing,
    registeredProjectRootMismatch,
    gitMismatch,
    gitUnavailable,
  });

  return {
    safeForWrites,
    ambiguous: markerMissing || markerMismatch || registeredProjectRootMissing || registeredProjectRootMismatch || gitMismatch,
    rootMismatch,
    markerMissing,
    markerMismatch,
    registeredProjectRootMissing,
    registeredProjectRootMismatch,
    gitMismatch,
    gitUnavailable,
    warnings,
  };
}

function unknownRootSafety(): DoctorSnapshot['project']['safety'] {
  return {
    safeForWrites: null,
    ambiguous: null,
    rootMismatch: null,
    markerMissing: false,
    markerMismatch: false,
    registeredProjectRootMissing: false,
    registeredProjectRootMismatch: false,
    gitMismatch: false,
    gitUnavailable: true,
    warnings: ['project root unavailable'],
  };
}

function buildSafetyWarnings(signals: {
  markerMissing: boolean;
  markerMismatch: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
}): string[] {
  const warnings: string[] = [];
  if (signals.markerMissing) warnings.push('missing local project marker');
  if (signals.markerMismatch) warnings.push('marker project id mismatch');
  if (signals.registeredProjectRootMissing) warnings.push('registered project root missing');
  if (signals.registeredProjectRootMismatch) warnings.push('registered project root mismatch');
  if (signals.gitMismatch) warnings.push('git worktree mismatch');
  if (signals.gitUnavailable) warnings.push('git identity unavailable');
  return warnings;
}

function deriveProjectSeverity(
  safety: DoctorSnapshot['project']['safety'],
): DoctorSeverity {
  if (safety.safeForWrites === null) {
    return 'unknown';
  }
  return safety.safeForWrites ? 'ok' : 'unsafe';
}

function deriveRuntimeSeverity(engineRange: string | null, npmVersion: string | null): DoctorSeverity {
  if (!engineRange || !npmVersion) {
    return 'unknown';
  }
  return checkNodeEngineSatisfaction(process.version, engineRange) ? 'ok' : 'warn';
}

function deriveDaemonSeverity(
  running: boolean | null,
  stalePidFile: boolean,
  readError: string | null,
): DoctorSeverity {
  if (readError) {
    return 'unknown';
  }
  if (running) {
    return 'ok';
  }
  return stalePidFile ? 'warn' : 'warn';
}

function checkNodeEngineSatisfaction(nodeVersion: string, engineRange: string): boolean | null {
  const match = engineRange.match(/^>=\s*(\d+)/);
  const current = nodeVersion.match(/^v?(\d+)/);
  if (!match || !current) {
    return null;
  }

  return Number(current[1]) >= Number(match[1]);
}

function readDaemonStatus(pidFilePath: string): {
  running: boolean | null;
  stalePidFile: boolean;
  endpoint: string | null;
  projectId: string | null;
  projectRoot: string | null;
  readError: string | null;
} {
  try {
    const raw = fs.readFileSync(pidFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      pid?: unknown;
      host?: unknown;
      port?: unknown;
      projectId?: unknown;
      projectRoot?: unknown;
    };
    const pid = typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0
      ? parsed.pid
      : null;

    if (pid === null) {
      return {
        running: false,
        stalePidFile: true,
        endpoint: null,
        projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
        projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null,
        readError: null,
      };
    }

    const running = processExists(pid);
    const host = typeof parsed.host === 'string' ? parsed.host : '127.0.0.1';
    const port = typeof parsed.port === 'number' ? parsed.port : 3737;
    return {
      running,
      stalePidFile: !running,
      endpoint: running ? `http://${host}:${port}/mcp` : null,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : null,
      readError: null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        running: false,
        stalePidFile: false,
        endpoint: null,
        projectId: null,
        projectRoot: null,
        readError: null,
      };
    }

    return {
      running: null,
      stalePidFile: false,
      endpoint: null,
      projectId: null,
      projectRoot: null,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readManagedDocsSnapshot(options: {
  projectId: string;
  projectRoot: string;
  storage: StoragePaths;
  sourceBranch: string | null;
}): Promise<DoctorSnapshot['managedDocs']> {
  const managedRepoPath = options.storage.projectRepoPath(options.projectId);
  const gitStore = new GitStore(managedRepoPath);

  if (!await gitStore.isInitialized()) {
    return {
      severity: 'unknown',
      available: false,
      managedRepoPath,
      managedBranch: null,
      sourceBranch: options.sourceBranch,
      exportRequired: null,
      workingTreeOutOfSync: null,
      ownedPathCount: null,
      outOfSyncPaths: [],
      unavailableReason: 'managed docs store is not initialized',
    };
  }

  const candidateBranch = options.sourceBranch && await gitStore.branchExists(options.sourceBranch)
    ? options.sourceBranch
    : await gitStore.branchExists('main')
      ? 'main'
      : null;

  if (!candidateBranch) {
    return {
      severity: 'unknown',
      available: false,
      managedRepoPath,
      managedBranch: null,
      sourceBranch: options.sourceBranch,
      exportRequired: null,
      workingTreeOutOfSync: null,
      ownedPathCount: null,
      outOfSyncPaths: [],
      unavailableReason: 'no readable managed branch found',
    };
  }

  const ownedPaths = await readOwnedPaths(gitStore, candidateBranch);
  const comparisons = await Promise.all(
    ownedPaths.map(async (filePath) => ({
      filePath,
      managedContent: await gitStore.readFile(candidateBranch, filePath),
      workingTreeContent: await readWorkingTreeFile(options.projectRoot, filePath),
    })),
  );

  const outOfSyncPaths = comparisons
    .filter(({ managedContent, workingTreeContent }) => (managedContent ?? null) !== (workingTreeContent ?? null))
    .map(({ filePath }) => filePath);

  return {
    severity: outOfSyncPaths.length > 0 ? 'warn' : 'ok',
    available: true,
    managedRepoPath,
    managedBranch: candidateBranch,
    sourceBranch: options.sourceBranch,
    exportRequired: outOfSyncPaths.length > 0,
    workingTreeOutOfSync: outOfSyncPaths.length > 0,
    ownedPathCount: ownedPaths.length,
    outOfSyncPaths,
    unavailableReason:
      options.sourceBranch && options.sourceBranch !== candidateBranch
        ? `managed branch "${options.sourceBranch}" unavailable; inspected "${candidateBranch}" instead`
        : null,
  };
}

async function readOwnedPaths(gitStore: GitStore, branch: string): Promise<string[]> {
  const trackedFiles = await gitStore.listFiles(branch);
  const manifestContent = await gitStore.readFile(branch, 'docs/manifest.yml');
  const manifestPaths = new Set<string>();

  if (manifestContent) {
    try {
      const { parse } = await import('yaml');
      const parsed = parse(manifestContent) as { documents?: Array<{ path?: unknown }> } | null;
      for (const document of parsed?.documents ?? []) {
        if (typeof document?.path === 'string' && document.path.trim().length > 0) {
          manifestPaths.add(document.path.replace(/\\/g, '/'));
        }
      }
    } catch {
      // Fail soft and fall back to the canonical always-owned paths only.
    }
  }

  return trackedFiles.filter((filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    return (
      normalized === 'STATUS.md' ||
      normalized === 'AGENTS.md' ||
      normalized === '.docs-policy.yml' ||
      normalized === 'docs/manifest.yml' ||
      normalized.startsWith('docs/atlas/') ||
      manifestPaths.has(normalized)
    );
  });
}

async function readWorkingTreeFile(baseDir: string, filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path.join(baseDir, filePath), 'utf-8');
  } catch {
    return null;
  }
}

async function readRootLedgerSnapshot(
  dbPath: string,
  identity: Parameters<typeof buildRootLedgerIdentityKey>[0],
): Promise<RootLedgerSnapshot> {
  const summary = await readExistingRootLedgerSummary(dbPath, identity);
  return {
    available: summary.available,
    severity: summary.available
      ? summary.warnings.length > 0
        ? 'warn'
        : 'ok'
      : 'unknown',
    knownObservationCount: summary.knownObservationCount,
    currentObservationCount: summary.currentObservationCount,
    distinctCanonicalProjectRootCount: summary.distinctCanonicalProjectRootCount,
    distinctGitWorktreeRootCount: summary.distinctGitWorktreeRootCount,
    distinctGitCommonDirCount: summary.distinctGitCommonDirCount,
    lastObservedAt: summary.lastObservedAt,
    warnings: summary.warnings,
  };
}

function unavailableRootLedgerSnapshot(reason: string): RootLedgerSnapshot {
  return {
    available: false,
    severity: 'unknown',
    knownObservationCount: null,
    currentObservationCount: null,
    distinctCanonicalProjectRootCount: null,
    distinctGitWorktreeRootCount: null,
    distinctGitCommonDirCount: null,
    lastObservedAt: null,
    warnings: [reason],
  };
}

async function readRecoverySnapshot(
  dbPath: string,
  identity: Parameters<typeof buildRootLedgerIdentityKey>[0],
): Promise<DoctorSnapshot['recovery']> {
  const evidence = await readRecoveryEvidence(dbPath, identity);
  if (!evidence.available) {
    return unavailableRecoverySnapshot(evidence.unavailableReason ?? 'recovery evidence unavailable');
  }

  const warnings: string[] = [];

  if ((evidence.pendingForeignRootProposalCount ?? 0) > 0) {
    warnings.push('pending proposals exist from another observed root context');
  }
  if (evidence.lastPreviewObservation?.metadata?.rootUnsafe) {
    warnings.push('latest preview observation was recorded under an unsafe root context');
  }
  if (evidence.lastExportObservation?.metadata?.rootUnsafe) {
    warnings.push('latest export observation was recorded under an unsafe root context');
  }

  return {
    severity:
      (evidence.pendingProposalCount ?? 0) > 0 || warnings.length > 0
        ? 'warn'
        : 'ok',
    available: true,
    pendingProposalCount: evidence.pendingProposalCount,
    pendingCurrentRootProposalCount: evidence.pendingCurrentRootProposalCount,
    pendingForeignRootProposalCount: evidence.pendingForeignRootProposalCount,
    pendingUnknownRootProposalCount: evidence.pendingUnknownRootProposalCount,
    lastPreviewExportObservation: toDoctorRecoveryObservation(evidence.lastPreviewObservation),
    lastExportObservation: toDoctorRecoveryObservation(evidence.lastExportObservation),
    warnings,
    unavailableReason: null,
  };
}

function unavailableRecoverySnapshot(reason: string): DoctorSnapshot['recovery'] {
  return {
    severity: 'unknown',
    available: false,
    pendingProposalCount: null,
    pendingCurrentRootProposalCount: null,
    pendingForeignRootProposalCount: null,
    pendingUnknownRootProposalCount: null,
    lastPreviewExportObservation: null,
    lastExportObservation: null,
    warnings: [],
    unavailableReason: reason,
  };
}

function toDoctorRecoveryObservation(
  observation: Awaited<ReturnType<typeof readRecoveryEvidence>>['lastPreviewObservation'],
): DoctorRecoveryObservation | null {
  if (!observation) {
    return null;
  }

  return {
    branch: observation.branch,
    createdAt: observation.createdAt,
    safeForWrites: observation.metadata?.safeForWrites ?? null,
    rootUnsafe: observation.metadata?.rootUnsafe ?? null,
    exportRequired: observation.metadata?.exportRequired ?? null,
    exportBlocked: observation.metadata?.exportBlocked ?? null,
    warningCount: observation.metadata?.warnings.length ?? null,
  };
}

function comparePaths(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function foldSeverities(severities: DoctorSeverity[]): DoctorSeverity {
  if (severities.includes('unsafe')) {
    return 'unsafe';
  }
  if (severities.includes('warn')) {
    return 'warn';
  }
  if (severities.includes('unknown')) {
    return 'unknown';
  }
  return 'ok';
}

function buildNextSteps(input: {
  projectSeverity: DoctorSeverity;
  daemonSeverity: DoctorSeverity;
  managedDocsSeverity: DoctorSeverity;
  recoverySeverity: DoctorSeverity;
  workingTreeClean: boolean | null;
  managedDocs: DoctorSnapshot['managedDocs'];
  recovery: DoctorSnapshot['recovery'];
}): string[] {
  const steps: string[] = [];

  if (input.projectSeverity === 'unsafe') {
    steps.push('Inspect the local marker, registry root, and Git worktree binding before any managed write or export.');
  }
  if (input.daemonSeverity === 'warn') {
    steps.push('If you need MCP access, inspect daemon status before assuming the local endpoint is available.');
  }
  if (input.managedDocsSeverity === 'warn' && input.managedDocs.outOfSyncPaths.length > 0) {
    steps.push(`Managed docs differ from disk for ${input.managedDocs.outOfSyncPaths.length} path(s); review drift before any commit or export.`);
  }
  if (input.recoverySeverity === 'warn' && (input.recovery.pendingProposalCount ?? 0) > 0) {
    steps.push('Pending Atlas proposals exist; review whether they are current-root work, valid managed-state sync, or stale drift.');
  }
  if (input.workingTreeClean === false) {
    steps.push('The source working tree is not clean; separate source edits from managed-doc drift before release-oriented work.');
  }
  if (steps.length === 0) {
    steps.push('No immediate non-destructive follow-up is required from this snapshot.');
  }

  return steps;
}

function formatBoolean(value: boolean | null, yes: string, no: string): string {
  if (value === null) {
    return 'unknown';
  }
  return value ? yes : no;
}
