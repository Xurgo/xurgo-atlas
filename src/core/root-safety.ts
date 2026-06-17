import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from './project.js';
import { Registry } from './registry.js';
import { inspectGitIdentity, normalizeExistingPath, type GitIdentity } from './git-identity.js';
import { StoragePaths } from './storage.js';
import {
  recordRootObservationIfPossible,
  unavailableRootLedgerSummary,
  type RootLedgerSummary,
} from './root-ledger.js';

export interface RootSafetyContext {
  requestedCwd: string;
  projectId: string;
  projectRoot: string;
  canonicalProjectRoot: string;
  registeredProjectRoot: string | null;
  daemonProjectRoot: string | null;
  markerPath: string;
  markerProjectId: string | null;
  git: GitIdentity;
  safety: RootSafetySummary;
  rootLedger: RootLedgerSummary;
}

export interface RootSafetySummary {
  safeForWrites: boolean;
  ambiguous: boolean;
  rootMismatch: boolean;
  markerMismatch: boolean;
  markerMissing: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
  warnings: string[];
}

export interface RootSafetyGuardOptions {
  operation: string;
  requestedCwd?: string;
  daemonProjectRoot?: string | null;
}

export interface RootMismatchSignals {
  markerMismatch?: boolean;
  registeredProjectRootMismatch?: boolean;
  daemonProjectRootMismatch?: boolean;
  gitMismatch?: boolean;
}

export interface RootSafetyRefusal {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export interface InspectResolvedRootSafetyContextOptions {
  projectId: string;
  projectRoot: string;
  configDir?: string;
  dataDir?: string;
  requestedCwd?: string;
  daemonProjectRoot?: string | null;
}

export async function inspectRootSafetyContext(
  project: Project,
  options: Pick<RootSafetyGuardOptions, 'requestedCwd' | 'daemonProjectRoot'> = {},
): Promise<RootSafetyContext> {
  return inspectResolvedRootSafetyContext({
    projectId: project.projectId,
    projectRoot: project.root,
    configDir: project.storage.configDir,
    dataDir: project.storage.dataDir,
    requestedCwd: options.requestedCwd,
    daemonProjectRoot: options.daemonProjectRoot,
  });
}

export async function inspectResolvedRootSafetyContext(
  options: InspectResolvedRootSafetyContextOptions,
): Promise<RootSafetyContext> {
  const requestedCwd = path.resolve(options.requestedCwd ?? process.cwd());
  const canonicalProjectRoot = normalizeExistingPath(options.projectRoot) ?? path.resolve(options.projectRoot);
  const registry = await Registry.load(options.configDir, options.dataDir);
  const registeredProjectRoot = registry.getProject(options.projectId)?.projectRoot ?? null;
  const markerPath = path.join(options.projectRoot, '.xurgo-atlas', 'project.json');
  const marker = await readJsonFile(markerPath);
  const git = await inspectGitIdentity(options.projectRoot);

  const markerMissing = marker === null;
  const markerMismatch = Boolean(
    marker && typeof marker.projectId === 'string' && marker.projectId !== options.projectId,
  );
  const registeredProjectRootMissing = registeredProjectRoot === null;
  const registeredProjectRootMismatch = registeredProjectRoot
    ? !comparePaths(registeredProjectRoot, canonicalProjectRoot)
    : false;
  const daemonProjectRoot = options.daemonProjectRoot ?? null;
  const daemonProjectRootMismatch = daemonProjectRoot
    ? !comparePaths(daemonProjectRoot, canonicalProjectRoot)
    : false;
  const gitUnavailable = !git.insideWorkTree;
  const gitMismatch = git.insideWorkTree
    ? !comparePaths(git.worktreeRoot, canonicalProjectRoot)
    : false;
  // Preserve the historical `rootMismatch` field for compatibility, but the
  // actual write gate still comes from `safeForWrites`.
  const rootMismatch = computeRootMismatch({
    markerMismatch,
    registeredProjectRootMismatch,
    daemonProjectRootMismatch,
    gitMismatch,
  });

  const safeForWrites =
    !markerMissing &&
    !markerMismatch &&
    !registeredProjectRootMissing &&
    !registeredProjectRootMismatch &&
    !daemonProjectRootMismatch &&
    !gitMismatch;

  const ambiguous =
    markerMissing ||
    markerMismatch ||
    registeredProjectRootMissing ||
    registeredProjectRootMismatch ||
    daemonProjectRootMismatch ||
    gitMismatch;

  const contextWithoutLedger = {
    requestedCwd,
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    canonicalProjectRoot,
    registeredProjectRoot,
    daemonProjectRoot,
    markerPath,
    markerProjectId: typeof marker?.projectId === 'string' ? marker.projectId : null,
    git,
    safety: {
      safeForWrites,
      ambiguous,
      rootMismatch,
      markerMismatch,
      markerMissing,
      registeredProjectRootMissing,
      registeredProjectRootMismatch,
      daemonProjectRootMismatch,
      gitMismatch,
      gitUnavailable,
      warnings: buildSafetyWarnings({
        markerMissing,
        markerMismatch,
        registeredProjectRootMissing,
        registeredProjectRootMismatch,
        daemonProjectRootMismatch,
        gitMismatch,
        gitUnavailable,
      }),
    },
  };

  return {
    ...contextWithoutLedger,
    rootLedger: await observeRootLedger(contextWithoutLedger, {
      configDir: options.configDir,
      dataDir: options.dataDir,
    }),
  };
}

export function computeRootMismatch(signals: RootMismatchSignals): boolean {
  return Boolean(
    signals.markerMismatch ||
      signals.registeredProjectRootMismatch ||
      signals.daemonProjectRootMismatch ||
      signals.gitMismatch,
  );
}

export async function guardRootSafety(
  project: Project,
  options: RootSafetyGuardOptions,
): Promise<RootSafetyRefusal | null> {
  const rootContext = await inspectRootSafetyContext(project, options);
  if (rootContext.safety.safeForWrites) {
    return null;
  }

  const issues = buildSafetyIssues(rootContext);
  const message = `Refusing to run ${options.operation} because the project root context is unsafe.`;

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            code: 'ROOT_CONTEXT_UNSAFE',
            message,
            projectId: project.projectId,
            requestedCwd: rootContext.requestedCwd,
            projectRoot: rootContext.projectRoot,
            canonicalProjectRoot: rootContext.canonicalProjectRoot,
            registeredProjectRoot: rootContext.registeredProjectRoot,
            daemonProjectRoot: rootContext.daemonProjectRoot,
            markerPath: rootContext.markerPath,
            markerProjectId: rootContext.markerProjectId,
            git: rootContext.git,
            safety: rootContext.safety,
            rootLedger: rootContext.rootLedger,
            issues,
            nextStep: [
              'Run docs.status to inspect rootContext.',
              'Run xurgo-atlas mcp-config --json from the intended project root.',
              'Run xurgo-atlas init in this checkout if the local marker is missing.',
              'Stop and resolve the root mismatch before running managed-doc writes or exports.',
            ].join(' '),
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * Strict root guard for managed-document writes and exports.
 *
 * Cleanup/recovery operations such as proposal discard intentionally do not
 * use this gate so they can still retire stale proposal state when the root
 * context is unsafe.
 */
export async function guardManagedWriteSafety(
  project: Project,
  options: RootSafetyGuardOptions,
): Promise<RootSafetyRefusal | null> {
  return guardRootSafety(project, options);
}

function buildSafetyIssues(context: RootSafetyContext): string[] {
  const issues: string[] = [];
  if (context.safety.markerMissing) {
    issues.push('missing local project marker');
  }
  if (context.safety.markerMismatch) {
    issues.push('marker project id mismatch');
  }
  if (context.safety.registeredProjectRootMissing) {
    issues.push('registered project root missing');
  }
  if (context.safety.registeredProjectRootMismatch) {
    issues.push('registered project root mismatch');
  }
  if (context.safety.daemonProjectRootMismatch) {
    issues.push('daemon-bound root mismatch');
  }
  if (context.safety.gitMismatch) {
    issues.push('git worktree mismatch');
  }
  if (context.safety.gitUnavailable) {
    issues.push('git identity unavailable');
  }
  return issues;
}

function buildSafetyWarnings(signals: {
  markerMissing: boolean;
  markerMismatch: boolean;
  registeredProjectRootMissing: boolean;
  registeredProjectRootMismatch: boolean;
  daemonProjectRootMismatch: boolean;
  gitMismatch: boolean;
  gitUnavailable: boolean;
}): string[] {
  const warnings: string[] = [];
  if (signals.markerMissing) {
    warnings.push('missing local project marker');
  }
  if (signals.markerMismatch) {
    warnings.push('marker project id mismatch');
  }
  if (signals.registeredProjectRootMissing) {
    warnings.push('registered project root missing');
  }
  if (signals.registeredProjectRootMismatch) {
    warnings.push('registered project root mismatch');
  }
  if (signals.daemonProjectRootMismatch) {
    warnings.push('daemon-bound root mismatch');
  }
  if (signals.gitMismatch) {
    warnings.push('git worktree mismatch');
  }
  if (signals.gitUnavailable) {
    warnings.push('git identity unavailable');
  }
  return warnings;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function comparePaths(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = normalizeExistingPath(left);
  const normalizedRight = normalizeExistingPath(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

async function observeRootLedger(
  context: Omit<RootSafetyContext, 'rootLedger'>,
  storage: { configDir?: string; dataDir?: string },
): Promise<RootLedgerSummary> {
  try {
    // Best-effort only: the ledger enriches status/config output, but failures
    // must not veto root safety or break read-only command paths.
    const registry = await Registry.load(storage.configDir, storage.dataDir);
    if (!registry.getProject(context.projectId)) {
      return unavailableRootLedgerSummary(
        `Root ledger storage is unavailable because project "${context.projectId}" is not registered.`,
      );
    }

    const dbPath = new StoragePaths({
      configDir: registry.configDir,
      dataDir: registry.dataDir,
    }).projectEventsPath(context.projectId);
    return recordRootObservationIfPossible(dbPath, {
      projectId: context.projectId,
      requestedCwd: context.requestedCwd,
      projectRoot: context.projectRoot,
      canonicalProjectRoot: context.canonicalProjectRoot,
      registeredProjectRoot: context.registeredProjectRoot,
      daemonProjectRoot: context.daemonProjectRoot,
      markerPath: context.markerPath,
      markerRootPath: context.safety.markerMissing ? null : path.dirname(path.dirname(context.markerPath)),
      markerProjectId: context.markerProjectId,
      git: context.git,
      safety: context.safety,
    });
  } catch (error) {
    return unavailableRootLedgerSummary(
      `Root ledger recording failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
