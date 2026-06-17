import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from './project.js';
import { Registry } from './registry.js';
import { inspectGitIdentity, normalizeExistingPath, type GitIdentity } from './git-identity.js';

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
}

export interface RootSafetySummary {
  safeForWrites: boolean;
  ambiguous: boolean;
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

export interface RootSafetyRefusal {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export async function inspectRootSafetyContext(
  project: Project,
  options: Pick<RootSafetyGuardOptions, 'requestedCwd' | 'daemonProjectRoot'> = {},
): Promise<RootSafetyContext> {
  const requestedCwd = path.resolve(options.requestedCwd ?? process.cwd());
  const canonicalProjectRoot = normalizeExistingPath(project.root) ?? path.resolve(project.root);
  const registry = await Registry.load(project.storage.configDir, project.storage.dataDir);
  const registeredProjectRoot = registry.getProject(project.projectId)?.projectRoot ?? null;
  const markerPath = path.join(project.root, '.xurgo-atlas', 'project.json');
  const marker = await readJsonFile(markerPath);
  const git = await inspectGitIdentity(project.root);

  const markerMissing = marker === null;
  const markerMismatch = Boolean(
    marker && typeof marker.projectId === 'string' && marker.projectId !== project.projectId,
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

  const warnings: string[] = [];
  if (gitUnavailable) {
    warnings.push('Git worktree identity is unavailable for this checkout.');
  }
  if (registeredProjectRoot && comparePaths(registeredProjectRoot, canonicalProjectRoot)) {
    // No-op. Keep the branch explicit so the helper remains easy to extend.
  }

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

  return {
    requestedCwd,
    projectId: project.projectId,
    projectRoot: project.root,
    canonicalProjectRoot,
    registeredProjectRoot,
    daemonProjectRoot,
    markerPath,
    markerProjectId: typeof marker?.projectId === 'string' ? marker.projectId : null,
    git,
    safety: {
      safeForWrites,
      ambiguous,
      markerMismatch,
      markerMissing,
      registeredProjectRootMissing,
      registeredProjectRootMismatch,
      daemonProjectRootMismatch,
      gitMismatch,
      gitUnavailable,
      warnings,
    },
  };
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
