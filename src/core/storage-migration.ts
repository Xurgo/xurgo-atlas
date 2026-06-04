import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  inspectManagedStorage,
  type RegistryInspection,
  type RuntimeArtifactInspection,
  type SelectedStorageInspection,
  type StorageNamespaceInspection,
} from './storage-inspect.js';
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

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
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
