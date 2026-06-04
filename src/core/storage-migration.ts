import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  inspectManagedStorage,
  type RegistryInspection,
  type RuntimeArtifactInspection,
  type SelectedStorageInspection,
  type StorageNamespaceInspection,
} from './storage-inspect.js';
import type { RegistryData } from './registry.js';
import { StoragePaths, normalizeStorageRoot, type StorageConfig } from './storage.js';

export type StorageMigrationClassification =
  | 'no-legacy-roots-found'
  | 'legacy-only-roots-found'
  | 'atlas-target-populated'
  | 'both-atlas-and-legacy-present'
  | 'partial-legacy-config-only'
  | 'partial-legacy-data-only';

export interface StorageMigrationRegistryInspection extends RegistryInspection {
  projectIds: string[] | null;
  storedConfigDir: string | null;
  storedDataDir: string | null;
  configDirMismatch: boolean | null;
  dataDirMismatch: boolean | null;
}

export interface StorageMigrationRuntimeInspection extends RuntimeArtifactInspection {
  presentArtifacts: string[];
  activePidFilePresent: boolean;
}

export interface StorageMigrationNamespaceCandidate {
  label: 'atlas' | 'legacy';
  role: 'source' | 'target';
  configDir: string;
  dataDir: string;
  present: boolean;
  dataDirExists: boolean;
  dataDirPopulated: boolean;
  registry: StorageMigrationRegistryInspection;
  runtime: StorageMigrationRuntimeInspection;
}

export interface StorageMigrationPlan {
  mode: 'dry-run';
  selected: SelectedStorageInspection;
  source: StorageMigrationNamespaceCandidate;
  target: StorageMigrationNamespaceCandidate;
  classifications: StorageMigrationClassification[];
  projectIdConflicts: string[];
  futureCopyActions: string[];
  futureSkipActions: string[];
  blockers: string[];
  warnings: string[];
  nextAction: string;
  noChangesMade: true;
}

export interface StorageMigrationApplyResult {
  mode: 'apply';
  source: StorageMigrationNamespaceCandidate;
  target: StorageMigrationNamespaceCandidate;
  copiedProjectIds: string[];
  runtimeArtifactsSkipped: string[];
  copyActions: string[];
  warnings: string[];
  legacyRootsUntouched: true;
  wroteAtlasTargetRoots: true;
}

export class StorageMigrationCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageMigrationCommandError';
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseRegistryInspection(
  registryPath: string,
  expectedConfigDir: string,
  expectedDataDir: string,
): StorageMigrationRegistryInspection {
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectIds = (
      parsed.projects &&
      typeof parsed.projects === 'object' &&
      !Array.isArray(parsed.projects)
    )
      ? Object.keys(parsed.projects as Record<string, unknown>).sort()
      : [];
    const storedConfigDir = typeof parsed.configDir === 'string'
      ? normalizeStorageRoot(parsed.configDir)
      : null;
    const storedDataDir = typeof parsed.dataDir === 'string'
      ? normalizeStorageRoot(parsed.dataDir)
      : null;

    return {
      path: registryPath,
      exists: true,
      projectCount: projectIds.length,
      readError: null,
      projectIds,
      storedConfigDir,
      storedDataDir,
      configDirMismatch: storedConfigDir == null ? null : storedConfigDir !== expectedConfigDir,
      dataDirMismatch: storedDataDir == null ? null : storedDataDir !== expectedDataDir,
    };
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return {
        path: registryPath,
        exists: false,
        projectCount: null,
        readError: null,
        projectIds: null,
        storedConfigDir: null,
        storedDataDir: null,
        configDirMismatch: null,
        dataDirMismatch: null,
      };
    }

    return {
      path: registryPath,
      exists: fs.existsSync(registryPath),
      projectCount: null,
      readError: error instanceof Error ? error.message : String(error),
      projectIds: null,
      storedConfigDir: null,
      storedDataDir: null,
      configDirMismatch: null,
      dataDirMismatch: null,
    };
  }
}

function inspectRuntimeArtifacts(
  configDir: string,
  dataDir: string,
): StorageMigrationRuntimeInspection {
  const storage = new StoragePaths({ configDir, dataDir });
  const runtimeDir = storage.runtimeDir();
  const pidFile = storage.daemonPidFilePath();
  const logFile = storage.daemonLogPath();
  const presentArtifacts: string[] = [];

  let runtimeDirExists = false;
  try {
    runtimeDirExists = fs.statSync(runtimeDir).isDirectory();
  } catch {
    runtimeDirExists = false;
  }

  if (runtimeDirExists) {
    presentArtifacts.push(runtimeDir);
  }
  if (fs.existsSync(pidFile)) {
    presentArtifacts.push(pidFile);
  }
  if (fs.existsSync(logFile)) {
    presentArtifacts.push(logFile);
  }

  return {
    runtimeDir,
    runtimeDirExists,
    pidFile,
    pidFileExists: fs.existsSync(pidFile),
    logFile,
    logFileExists: fs.existsSync(logFile),
    presentArtifacts,
    activePidFilePresent: fs.existsSync(pidFile),
  };
}

function buildNamespaceCandidate(
  role: 'source' | 'target',
  inspection: StorageNamespaceInspection,
): StorageMigrationNamespaceCandidate {
  return {
    label: inspection.label,
    role,
    configDir: inspection.configDir,
    dataDir: inspection.dataDir,
    present: inspection.present,
    dataDirExists: inspection.dataDirExists,
    dataDirPopulated: inspection.dataDirPopulated,
    registry: parseRegistryInspection(
      inspection.registry.path,
      inspection.configDir,
      inspection.dataDir,
    ),
    runtime: inspectRuntimeArtifacts(inspection.configDir, inspection.dataDir),
  };
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function addRuntimeSkipActions(
  plan: StorageMigrationPlan,
  candidate: StorageMigrationNamespaceCandidate,
): void {
  const prefix = candidate.role === 'source'
    ? 'Legacy source runtime artifact would be skipped'
    : 'Existing Atlas runtime artifact would be left untouched';

  for (const artifact of candidate.runtime.presentArtifacts) {
    addUnique(plan.futureSkipActions, `${prefix}: ${artifact}`);
  }
}

function getNextAction(plan: StorageMigrationPlan): string {
  if (plan.blockers.length > 0) {
    return (
      'Resolve the blocker state first. This dry run will not plan an automatic ' +
      'merge, overwrite, or conflict resolution between legacy and Atlas roots.'
    );
  }

  if (plan.classifications.includes('atlas-target-populated') && !plan.source.present) {
    return 'Atlas managed storage is already in use. No legacy-to-Atlas migration is planned.';
  }

  if (plan.classifications.includes('no-legacy-roots-found')) {
    return 'No legacy managed storage was found. No migration is needed.';
  }

  if (
    plan.classifications.includes('partial-legacy-config-only') ||
    plan.classifications.includes('partial-legacy-data-only')
  ) {
    return (
      'Review the partial legacy state before any future migration is introduced. ' +
      'This command intentionally made no changes.'
    );
  }

  return (
    'Review this read-only plan only. Write-capable storage migration is not ' +
    'implemented yet, so no copy step can be executed from this command.'
  );
}

function addRefusalBlocker(blockers: string[], value: string): void {
  addUnique(blockers, value);
}

function getApplyBlockers(plan: StorageMigrationPlan): string[] {
  const blockers = [...plan.blockers];

  if (plan.classifications.includes('no-legacy-roots-found')) {
    addRefusalBlocker(
      blockers,
      'No legacy managed storage roots were found to copy into Atlas.',
    );
  }

  if (plan.classifications.includes('partial-legacy-config-only')) {
    addRefusalBlocker(
      blockers,
      'Legacy migration source is incomplete: the legacy registry exists, but the legacy data root is missing or empty.',
    );
  }

  if (plan.classifications.includes('partial-legacy-data-only')) {
    addRefusalBlocker(
      blockers,
      'Legacy migration source is incomplete: the legacy data root is populated, but the legacy registry file is missing.',
    );
  }

  if (plan.classifications.includes('both-atlas-and-legacy-present')) {
    addRefusalBlocker(
      blockers,
      'Atlas and legacy managed storage are both present. This apply step refuses merge or overwrite scenarios.',
    );
  }

  if (plan.classifications.includes('atlas-target-populated')) {
    addRefusalBlocker(
      blockers,
      'Atlas target roots are already populated. This apply step only supports copying into empty Atlas roots.',
    );
  }

  if (!plan.source.registry.exists) {
    addRefusalBlocker(
      blockers,
      'Legacy migration source is missing projects.json, so Atlas has no safe registry to copy.',
    );
  }

  if (!plan.source.dataDirExists || !plan.source.dataDirPopulated) {
    addRefusalBlocker(
      blockers,
      'Legacy migration source does not have populated managed project data to copy.',
    );
  }

  if (plan.source.registry.projectIds == null) {
    addRefusalBlocker(
      blockers,
      'Legacy projects.json could not be parsed into project IDs, so apply mode cannot validate the copy.',
    );
  }

  if (plan.target.registry.exists && plan.target.registry.projectIds == null) {
    addRefusalBlocker(
      blockers,
      'Atlas target projects.json exists but could not be parsed, so apply mode will not touch it.',
    );
  }

  if (plan.source.runtime.activePidFilePresent || plan.target.runtime.activePidFilePresent) {
    addRefusalBlocker(
      blockers,
      'A daemon PID file is present in managed storage. Stop active runtime use before running --apply.',
    );
  }

  return blockers;
}

function formatApplyRefusal(
  plan: StorageMigrationPlan,
  blockers: string[],
): string {
  const lines = [
    'Xurgo Atlas storage migration apply refused',
    'Mode: apply (copy-only)',
    '',
    'Legacy source roots:',
    `  configDir: ${plan.source.configDir}`,
    `  dataDir: ${plan.source.dataDir}`,
    '',
    'Atlas target roots:',
    `  configDir: ${plan.target.configDir}`,
    `  dataDir: ${plan.target.dataDir}`,
    '',
    'Blockers:',
    ...(blockers.length > 0 ? blockers.map((blocker) => `  - ${blocker}`) : ['  - none']),
  ];

  if (plan.warnings.length > 0) {
    lines.push('', 'Warnings:', ...plan.warnings.map((warning) => `  - ${warning}`));
  }

  lines.push(
    '',
    'No changes were made.',
    'Run `xurgo-atlas storage migrate --dry-run` to inspect the copy-only plan before retrying.',
  );

  return lines.join('\n');
}

function toProjectsRecord(parsed: Record<string, unknown>): RegistryData['projects'] {
  if (
    parsed.projects &&
    typeof parsed.projects === 'object' &&
    !Array.isArray(parsed.projects)
  ) {
    return parsed.projects as RegistryData['projects'];
  }

  return {};
}

function loadRegistryDataOrThrow(
  registryPath: string,
  fallbackConfigDir: string,
  fallbackDataDir: string,
): RegistryData {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (parsed.version === 2) {
    return {
      version: 2,
      configDir: typeof parsed.configDir === 'string'
        ? normalizeStorageRoot(parsed.configDir)
        : fallbackConfigDir,
      dataDir: typeof parsed.dataDir === 'string'
        ? normalizeStorageRoot(parsed.dataDir)
        : fallbackDataDir,
      defaultProjectId: typeof parsed.defaultProjectId === 'string'
        ? parsed.defaultProjectId
        : null,
      projects: toProjectsRecord(parsed),
    };
  }

  if (parsed.version === 1 || parsed.version == null) {
    return {
      version: 2,
      configDir: fallbackConfigDir,
      dataDir: fallbackDataDir,
      defaultProjectId: typeof parsed.defaultProjectId === 'string'
        ? parsed.defaultProjectId
        : null,
      projects: toProjectsRecord(parsed),
    };
  }

  throw new Error(`Unsupported registry schema version: ${String(parsed.version)}`);
}

function createTargetRegistryData(
  sourceRegistry: RegistryData,
  target: StorageMigrationNamespaceCandidate,
): RegistryData {
  return {
    ...sourceRegistry,
    version: 2,
    configDir: target.configDir,
    dataDir: target.dataDir,
    projects: { ...sourceRegistry.projects },
  };
}

function buildMigrationTempDir(finalDir: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(path.dirname(finalDir), `.${path.basename(finalDir)}.migrate-${suffix}`);
}

function isRuntimeArtifactPath(candidatePath: string, runtimeDir: string): boolean {
  const relative = path.relative(runtimeDir, candidatePath);
  return candidatePath === runtimeDir || (relative !== '' && !relative.startsWith('..'));
}

async function copyDirectoryExcludingRuntime(
  sourceDir: string,
  targetDir: string,
  runtimeDir: string,
): Promise<void> {
  await fs.promises.cp(sourceDir, targetDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (candidatePath) => !isRuntimeArtifactPath(candidatePath, runtimeDir),
  });
}

async function removeIfExists(targetPath: string): Promise<void> {
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}

async function ensureMissingOrEmptyDirectory(dirPath: string, description: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new StorageMigrationCommandError(
        `${description} exists at ${dirPath}, but it is not a directory.`,
      );
    }

    const entries = await fs.promises.readdir(dirPath);
    if (entries.length > 0) {
      throw new StorageMigrationCommandError(
        `${description} at ${dirPath} is already populated. Re-run --dry-run to inspect blockers.`,
      );
    }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

function validateProjectStoreOrThrow(
  dataDir: string,
  projectId: string,
): void {
  const projectDir = path.join(dataDir, 'projects', projectId);
  const repoPath = path.join(projectDir, 'repo.git');
  const eventsPath = path.join(projectDir, 'events.sqlite');

  if (!isDirectory(projectDir)) {
    throw new StorageMigrationCommandError(
      `Copied project store is missing for "${projectId}" at ${projectDir}.`,
    );
  }

  if (!isDirectory(repoPath)) {
    throw new StorageMigrationCommandError(
      `Copied project store for "${projectId}" is missing repo.git at ${repoPath}.`,
    );
  }

  if (!isFile(eventsPath)) {
    throw new StorageMigrationCommandError(
      `Copied project store for "${projectId}" is missing events.sqlite at ${eventsPath}.`,
    );
  }
}

function validateTargetRegistryOrThrow(
  registryPath: string,
  expectedConfigDir: string,
  expectedDataDir: string,
  expectedProjectIds: string[],
): void {
  const registry = loadRegistryDataOrThrow(registryPath, expectedConfigDir, expectedDataDir);
  const actualProjectIds = Object.keys(registry.projects).sort();

  if (registry.configDir !== expectedConfigDir) {
    throw new StorageMigrationCommandError(
      `Migrated Atlas registry points to ${registry.configDir}, expected ${expectedConfigDir}.`,
    );
  }

  if (registry.dataDir !== expectedDataDir) {
    throw new StorageMigrationCommandError(
      `Migrated Atlas registry points to ${registry.dataDir}, expected ${expectedDataDir}.`,
    );
  }

  if (actualProjectIds.join('\n') !== [...expectedProjectIds].sort().join('\n')) {
    throw new StorageMigrationCommandError(
      'Migrated Atlas registry project IDs do not match the legacy registry project IDs.',
    );
  }
}

async function finalizeMigrationRoots(
  tempDataDir: string,
  finalDataDir: string,
  tempConfigDir: string,
  finalConfigDir: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(finalDataDir), { recursive: true });
  await fs.promises.mkdir(path.dirname(finalConfigDir), { recursive: true });
  await ensureMissingOrEmptyDirectory(finalDataDir, 'Atlas target data directory');
  await ensureMissingOrEmptyDirectory(finalConfigDir, 'Atlas target config directory');

  if (isDirectory(finalDataDir)) {
    await fs.promises.rmdir(finalDataDir);
  }
  if (isDirectory(finalConfigDir)) {
    await fs.promises.rmdir(finalConfigDir);
  }

  await fs.promises.rename(tempDataDir, finalDataDir);

  try {
    await fs.promises.rename(tempConfigDir, finalConfigDir);
  } catch (error) {
    await removeIfExists(finalDataDir);
    throw error;
  }
}

export function planStorageMigration(
  config: StorageConfig = {},
): StorageMigrationPlan {
  const inspection = inspectManagedStorage(config);
  const source = buildNamespaceCandidate('source', inspection.legacy);
  const target = buildNamespaceCandidate('target', inspection.atlas);
  const plan: StorageMigrationPlan = {
    mode: 'dry-run',
    selected: inspection.selected,
    source,
    target,
    classifications: [],
    projectIdConflicts: [],
    futureCopyActions: [],
    futureSkipActions: [
      'Legacy roots would remain on disk. Any future migration must stay copy-only and non-destructive.',
    ],
    blockers: [],
    warnings: [],
    nextAction: '',
    noChangesMade: true,
  };

  const legacyConfigPresent = source.registry.exists;
  const legacyDataPresent = source.dataDirPopulated;
  const targetPersistentStatePresent = target.registry.exists || target.dataDirPopulated;
  const conflictIds = (
    source.registry.projectIds == null || target.registry.projectIds == null
  )
    ? []
    : source.registry.projectIds.filter((projectId) => target.registry.projectIds!.includes(projectId));

  if (!source.present) {
    plan.classifications.push('no-legacy-roots-found');
  }

  if (source.present && !target.present) {
    plan.classifications.push('legacy-only-roots-found');
  }

  if (target.present) {
    plan.classifications.push('atlas-target-populated');
  }

  if (inspection.bothPresent) {
    plan.classifications.push('both-atlas-and-legacy-present');
    addUnique(
      plan.blockers,
      'Both legacy and Atlas managed storage appear populated. This dry run will not plan an automatic merge.',
    );
  }

  if (legacyConfigPresent && !legacyDataPresent) {
    plan.classifications.push('partial-legacy-config-only');
    addUnique(
      plan.warnings,
      'Legacy registry exists, but the legacy data root is missing or empty.',
    );
  }

  if (!legacyConfigPresent && legacyDataPresent) {
    plan.classifications.push('partial-legacy-data-only');
    addUnique(
      plan.warnings,
      'Legacy data root is populated, but the legacy registry file is missing.',
    );
  }

  if (targetPersistentStatePresent && source.present) {
    addUnique(
      plan.blockers,
      'Atlas target storage already contains managed state. Future migration should not overwrite or merge it automatically.',
    );
  }

  if (source.registry.dataDirMismatch === true) {
    addUnique(
      plan.blockers,
      `Legacy registry metadata points to ${source.registry.storedDataDir}, which does not match the discovered legacy data root ${source.dataDir}.`,
    );
  }

  if (source.registry.configDirMismatch === true) {
    addUnique(
      plan.warnings,
      `Legacy registry metadata points to configDir ${source.registry.storedConfigDir}, while the discovered legacy config root is ${source.configDir}.`,
    );
  }

  if (source.registry.readError) {
    addUnique(
      plan.warnings,
      `Legacy registry could not be parsed for project counts or metadata: ${source.registry.readError}`,
    );
  }

  if (target.registry.readError) {
    addUnique(
      plan.warnings,
      `Atlas registry could not be parsed for project counts or metadata: ${target.registry.readError}`,
    );
  }

  if (conflictIds.length > 0) {
    plan.projectIdConflicts = conflictIds;
    addUnique(
      plan.blockers,
      `Legacy and Atlas registries both contain project IDs that would conflict: ${conflictIds.join(', ')}.`,
    );
  }

  if (source.registry.exists) {
    plan.futureCopyActions.push(
      `Copy the legacy registry file from ${source.registry.path} to ${target.registry.path} without editing the source in place.`,
    );
  }

  if (source.dataDirPopulated) {
    plan.futureCopyActions.push(
      `Copy managed project data from ${path.join(source.dataDir, 'projects')} to ${path.join(target.dataDir, 'projects')}.`,
    );
  }

  if (plan.futureCopyActions.length === 0) {
    plan.futureCopyActions.push('No legacy registry or populated legacy project data were found to copy.');
  }

  addRuntimeSkipActions(plan, source);
  addRuntimeSkipActions(plan, target);

  if (source.runtime.presentArtifacts.length > 0) {
    addUnique(
      plan.warnings,
      'Legacy runtime artifacts are present and would be skipped by any future migration.',
    );
  }

  if (target.runtime.presentArtifacts.length > 0) {
    addUnique(
      plan.warnings,
      'Atlas runtime artifacts are present and would be left untouched by any future migration.',
    );
  }

  if (source.runtime.activePidFilePresent || target.runtime.activePidFilePresent) {
    addUnique(
      plan.warnings,
      'A daemon PID file is present. This dry run did not stop any daemon, and future migration should treat runtime artifacts as non-migratable.',
    );
  }

  plan.nextAction = getNextAction(plan);

  return plan;
}

export async function applyStorageMigration(
  config: StorageConfig = {},
): Promise<StorageMigrationApplyResult> {
  const plan = planStorageMigration(config);
  const blockers = getApplyBlockers(plan);

  if (blockers.length > 0) {
    throw new StorageMigrationCommandError(formatApplyRefusal(plan, blockers));
  }

  const sourceRegistry = loadRegistryDataOrThrow(
    plan.source.registry.path,
    plan.source.configDir,
    plan.source.dataDir,
  );
  const copiedProjectIds = Object.keys(sourceRegistry.projects).sort();
  const tempConfigDir = buildMigrationTempDir(plan.target.configDir);
  const tempDataDir = buildMigrationTempDir(plan.target.dataDir);
  const tempRegistryPath = path.join(tempConfigDir, 'projects.json');
  const targetRegistry = createTargetRegistryData(sourceRegistry, plan.target);
  const runtimeArtifactsSkipped = [...plan.source.runtime.presentArtifacts].sort();
  const copyActions: string[] = [];

  await fs.promises.mkdir(path.dirname(tempConfigDir), { recursive: true });
  await fs.promises.mkdir(path.dirname(tempDataDir), { recursive: true });

  try {
    await ensureMissingOrEmptyDirectory(plan.target.configDir, 'Atlas target config directory');
    await ensureMissingOrEmptyDirectory(plan.target.dataDir, 'Atlas target data directory');

    await fs.promises.cp(plan.source.configDir, tempConfigDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    copyActions.push(`Copied legacy config root to staging directory: ${tempConfigDir}`);

    await copyDirectoryExcludingRuntime(
      plan.source.dataDir,
      tempDataDir,
      plan.source.runtime.runtimeDir,
    );
    copyActions.push(`Copied legacy data root to staging directory: ${tempDataDir}`);

    await fs.promises.mkdir(tempConfigDir, { recursive: true });
    await fs.promises.writeFile(
      tempRegistryPath,
      JSON.stringify(targetRegistry, null, 2) + '\n',
      'utf-8',
    );
    copyActions.push(`Rewrote staged Atlas registry for target roots: ${tempRegistryPath}`);

    validateTargetRegistryOrThrow(
      tempRegistryPath,
      plan.target.configDir,
      plan.target.dataDir,
      copiedProjectIds,
    );

    for (const projectId of copiedProjectIds) {
      validateProjectStoreOrThrow(tempDataDir, projectId);
    }

    await finalizeMigrationRoots(
      tempDataDir,
      plan.target.dataDir,
      tempConfigDir,
      plan.target.configDir,
    );
  } catch (error) {
    await removeIfExists(tempConfigDir);
    await removeIfExists(tempDataDir);
    throw error;
  }

  return {
    mode: 'apply',
    source: plan.source,
    target: plan.target,
    copiedProjectIds,
    runtimeArtifactsSkipped,
    copyActions,
    warnings: [...plan.warnings],
    legacyRootsUntouched: true,
    wroteAtlasTargetRoots: true,
  };
}
