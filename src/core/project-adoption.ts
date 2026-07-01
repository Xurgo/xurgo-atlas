import * as fs from 'node:fs';
import * as path from 'node:path';
import { Registry, type ProjectEntry } from './registry.js';
import {
  resolveProjectMarkerContext,
} from './project-resolution.js';
import { inspectGitIdentity, normalizeExistingPath, type GitIdentity } from './git-identity.js';

export interface ProjectAdoptionOptions {
  projectRoot?: string;
  projectId?: string;
  configDir?: string;
  dataDir?: string;
  cwd?: string;
}

export interface ProjectAdoptionContext {
  requestedRoot: string;
  requestedCanonicalRoot: string;
  canonicalProjectRoot: string;
  projectId: string;
  source: 'marker' | 'explicit';
  markerPath: string | null;
  markerProjectId: string | null;
  markerProjectRoot: string | null;
  markerSource: 'cwd-marker' | 'ancestor-marker' | null;
  git: GitIdentity;
  registryPath: string;
  registry: Registry;
  registryEntryById: ProjectEntry | null;
  registryEntryByRoot: ProjectEntry | null;
  alreadyAdopted: boolean;
}

export interface ProjectAdoptionResult {
  projectId: string;
  projectRoot: string;
  created: boolean;
  alreadyAdopted: boolean;
  markerPresent: boolean;
  markerPath: string | null;
  canonicalProjectRoot: string;
}

export class ProjectAdoptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectAdoptionError';
  }
}

export async function resolveProjectAdoptionContext(
  options: ProjectAdoptionOptions = {},
): Promise<ProjectAdoptionContext> {
  const requestedRoot = path.resolve(options.projectRoot ?? options.cwd ?? process.cwd());
  await ensureDirectory(requestedRoot);

  const requestedRootStat = await fs.promises.lstat(requestedRoot);
  const requestedCanonicalRoot = normalizeExistingPath(requestedRoot) ?? path.resolve(requestedRoot);
  if (requestedRootStat.isSymbolicLink()) {
    throw new ProjectAdoptionError(
      `The requested path "${requestedRoot}" resolves to "${requestedCanonicalRoot}". ` +
        'Project adoption must use the literal checkout root path, not a symlinked or aliased root.',
    );
  }

  const git = await inspectGitIdentity(requestedRoot);
  if (!git.insideWorkTree || !git.worktreeRoot) {
    throw new ProjectAdoptionError(
      `Project adoption requires a local Git checkout. The path "${requestedRoot}" is not inside a Git worktree.`,
    );
  }

  const canonicalProjectRoot = git.worktreeRoot;
  if (!samePath(requestedCanonicalRoot, canonicalProjectRoot)) {
    throw new ProjectAdoptionError(
      `The requested path "${requestedRoot}" resolves to "${requestedCanonicalRoot}", but the Git checkout root is "${canonicalProjectRoot}". ` +
        'Project adoption must target the checkout root, not a nested path or alternate location.',
    );
  }

  const checkoutGitDir = path.join(canonicalProjectRoot, '.git');
  if (!samePath(git.commonDir, checkoutGitDir)) {
    throw new ProjectAdoptionError(
      `The checkout at "${canonicalProjectRoot}" is a linked Git worktree. ` +
        'Project adoption is limited to the primary checkout root and does not register linked worktrees or additional clones.',
    );
  }

  const markerResolution = await resolveProjectMarkerContext(requestedRoot);
  const markerPath = markerResolution?.markerPath ?? null;
  const markerProjectId = markerResolution?.projectId ?? null;
  const markerProjectRoot = markerResolution?.projectRoot ?? null;
  const markerSource = markerResolution?.source ?? null;

  const explicitProjectId = options.projectId?.trim() ?? '';
  if (markerProjectId && explicitProjectId && markerProjectId !== explicitProjectId) {
    throw new ProjectAdoptionError(
      `Local project marker at ${markerPath} identifies project "${markerProjectId}", but explicit --project-id was "${explicitProjectId}". ` +
        'Use the matching project id or remove the marker before adopting a different project identity.',
    );
  }

  const projectId = markerProjectId ?? explicitProjectId;
  if (!projectId) {
    throw new ProjectAdoptionError(
      `No local project marker was found under "${requestedRoot}", and --project-id was not provided. ` +
        'Pass --project-id for markerless adoption.',
    );
  }
  validateProjectId(projectId, markerProjectId ? `marker at ${markerPath}` : '--project-id');

  const registry = await Registry.load(options.configDir, options.dataDir);
  const registryEntryById = registry.getProject(projectId);
  const registryEntryByRoot = registry.listProjects().find((entry) =>
    samePath(entry.projectRoot, canonicalProjectRoot),
  ) ?? null;

  if (registryEntryById && !samePath(registryEntryById.projectRoot, canonicalProjectRoot)) {
    const rootExists = await isDirectory(registryEntryById.projectRoot);
    throw new ProjectAdoptionError(
      `Project id "${projectId}" is already registered to ${registryEntryById.projectRoot}. ` +
        `This checkout resolves to ${canonicalProjectRoot}. ` +
        (rootExists
          ? 'Adoption will not rebind an existing registration. Use an explicit future rekey workflow if this is a different checkout.'
          : 'The registered root is missing, which looks like a moved checkout or stale registry entry. Adoption will not rebind it automatically.'),
    );
  }

  if (registryEntryByRoot && registryEntryByRoot.projectId !== projectId) {
    throw new ProjectAdoptionError(
      `This checkout resolves to ${canonicalProjectRoot}, which is already registered as project "${registryEntryByRoot.projectId}". ` +
        'Adoption will not overwrite or rebind that canonical root.',
    );
  }

  if (markerProjectRoot && !samePath(markerProjectRoot, canonicalProjectRoot)) {
    throw new ProjectAdoptionError(
      `Local marker at ${markerPath} resolves to ${markerProjectRoot}, but the checkout root is ${canonicalProjectRoot}. ` +
        'Project adoption requires the marker and checkout to agree on the same canonical root.',
    );
  }

  return {
    requestedRoot,
    requestedCanonicalRoot,
    canonicalProjectRoot,
    projectId,
    source: markerProjectId ? 'marker' : 'explicit',
    markerPath,
    markerProjectId,
    markerProjectRoot,
    markerSource,
    git,
    registryPath: path.join(registry.configDir, 'projects.json'),
    registry,
    registryEntryById,
    registryEntryByRoot,
    alreadyAdopted: Boolean(registryEntryById && samePath(registryEntryById.projectRoot, canonicalProjectRoot)),
  };
}

export async function adoptProject(
  options: ProjectAdoptionOptions = {},
): Promise<ProjectAdoptionResult> {
  const context = await resolveProjectAdoptionContext(options);

  if (context.alreadyAdopted) {
    return {
      projectId: context.projectId,
      projectRoot: context.canonicalProjectRoot,
      created: false,
      alreadyAdopted: true,
      markerPresent: context.markerProjectId !== null,
      markerPath: context.markerPath,
      canonicalProjectRoot: context.canonicalProjectRoot,
    };
  }

  await context.registry.addProject(context.projectId, context.canonicalProjectRoot);

  return {
    projectId: context.projectId,
    projectRoot: context.canonicalProjectRoot,
    created: true,
    alreadyAdopted: false,
    markerPresent: context.markerProjectId !== null,
    markerPath: context.markerPath,
    canonicalProjectRoot: context.canonicalProjectRoot,
  };
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  const stat = await fs.promises.stat(directoryPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new ProjectAdoptionError(
      `Project root "${directoryPath}" does not exist or is not a directory.`,
    );
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }

  return normalizeExistingPath(a) === normalizeExistingPath(b);
}

function validateProjectId(projectId: string, source: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)) {
    throw new ProjectAdoptionError(
      `Project identity "${projectId}" from ${source} is invalid. ` +
        'Use only letters, numbers, ".", "_", or "-".',
    );
  }
}
