import { inspectManagedStorage } from '../core/storage-inspect.js';
import {
  planStorageMigration,
  type StorageMigrationClassification,
} from '../core/storage-migration.js';
import type { StorageConfig } from '../core/storage.js';

export function getStorageUsageText(): string {
  return `
Inspect Xurgo Atlas managed storage roots.
Legacy alias: docu-guard (temporary)

USAGE:
  xurgo-atlas storage inspect [options]
  xurgo-atlas storage migrate --dry-run [options]

SUBCOMMANDS:
  inspect
    Show Atlas-vs-legacy storage discovery, selected roots, registry state,
    and runtime artifact presence without migrating or modifying files.
    --config-dir <path>   Inspect with an explicit config directory override
    --data-dir <path>     Inspect with an explicit data directory override

  migrate --dry-run
    Plan a future legacy-to-Atlas storage migration without creating
    directories, copying files, modifying registries, or touching runtime.
    --config-dir <path>   Inspect with an explicit config directory override
    --data-dir <path>     Inspect with an explicit data directory override

EXAMPLES:
  xurgo-atlas storage inspect
  xurgo-atlas storage migrate --dry-run
  xurgo-atlas storage inspect --config-dir ~/.config/xurgo-atlas --data-dir ~/.local/share/xurgo-atlas

This command is read-only. It does not migrate, create, copy, update, or delete storage files.
`;
}

export function printStorageUsage(): void {
  console.log(getStorageUsageText());
}

function formatYesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatProjectCount(projectCount: number | null): string {
  return projectCount == null ? 'unavailable' : String(projectCount);
}

function formatOptionalPath(value: string | null): string {
  return value == null ? 'unavailable' : value;
}

function formatBooleanOrUnknown(value: boolean | null): string {
  return value == null ? 'unknown' : formatYesNo(value);
}

function formatListSection(title: string, items: string[]): string[] {
  return [
    title,
    ...(items.length > 0 ? items.map((item) => `  - ${item}`) : ['  - none']),
  ];
}

function formatMigrationClassification(
  classification: StorageMigrationClassification,
): string {
  switch (classification) {
    case 'no-legacy-roots-found':
      return 'No legacy roots found';
    case 'legacy-only-roots-found':
      return 'Legacy-only roots found';
    case 'atlas-target-populated':
      return 'Atlas target already populated';
    case 'both-atlas-and-legacy-present':
      return 'Both Atlas and legacy roots present';
    case 'partial-legacy-config-only':
      return 'Partial legacy state: config only';
    case 'partial-legacy-data-only':
      return 'Partial legacy state: data only';
  }
}

export function formatStorageInspection(
  options: StorageConfig = {},
): string {
  const report = inspectManagedStorage(options);
  const lines = [
    'Xurgo Atlas storage inspection',
    'Mode: read-only (no migration, no file changes)',
    '',
    'Selected storage:',
    `  configDir: ${report.selected.configDir}`,
    `  dataDir: ${report.selected.dataDir}`,
    `  source: ${report.selected.sourceSummary}`,
    `  registry: ${report.selected.registry.path}`,
    `  registry exists: ${formatYesNo(report.selected.registry.exists)}`,
    `  registry project count: ${formatProjectCount(report.selected.registry.projectCount)}`,
    `  runtime dir: ${report.selected.runtime.runtimeDir}`,
    `  runtime dir exists: ${formatYesNo(report.selected.runtime.runtimeDirExists)}`,
    `  daemon pid file: ${report.selected.runtime.pidFile}`,
    `  daemon pid file exists: ${formatYesNo(report.selected.runtime.pidFileExists)}`,
    `  daemon log file: ${report.selected.runtime.logFile}`,
    `  daemon log file exists: ${formatYesNo(report.selected.runtime.logFileExists)}`,
    '',
    'Atlas candidates:',
    `  configDir: ${report.atlas.configDir}`,
    `  dataDir: ${report.atlas.dataDir}`,
    `  appears present: ${formatYesNo(report.atlas.present)}`,
    `  registry: ${report.atlas.registry.path}`,
    `  registry exists: ${formatYesNo(report.atlas.registry.exists)}`,
    `  registry project count: ${formatProjectCount(report.atlas.registry.projectCount)}`,
    `  data dir exists: ${formatYesNo(report.atlas.dataDirExists)}`,
    `  data dir populated: ${formatYesNo(report.atlas.dataDirPopulated)}`,
    '',
    'Legacy candidates:',
    `  configDir: ${report.legacy.configDir}`,
    `  dataDir: ${report.legacy.dataDir}`,
    `  appears present: ${formatYesNo(report.legacy.present)}`,
    `  registry: ${report.legacy.registry.path}`,
    `  registry exists: ${formatYesNo(report.legacy.registry.exists)}`,
    `  registry project count: ${formatProjectCount(report.legacy.registry.projectCount)}`,
    `  data dir exists: ${formatYesNo(report.legacy.dataDirExists)}`,
    `  data dir populated: ${formatYesNo(report.legacy.dataDirPopulated)}`,
    '',
    `Both Atlas and legacy roots appear present: ${formatYesNo(report.bothPresent)}`,
  ];

  if (report.selected.registry.readError) {
    lines.push(`Selected registry read warning: ${report.selected.registry.readError}`);
  }
  if (report.atlas.registry.readError) {
    lines.push(`Atlas registry read warning: ${report.atlas.registry.readError}`);
  }
  if (report.legacy.registry.readError) {
    lines.push(`Legacy registry read warning: ${report.legacy.registry.readError}`);
  }
  for (const diagnostic of report.diagnostics) {
    lines.push(`${diagnostic.level.toUpperCase()}: ${diagnostic.message}`);
  }

  lines.push('No files were modified. This command does not migrate storage.');

  return lines.join('\n');
}

export async function storageInspectCommand(
  options: StorageConfig = {},
): Promise<void> {
  console.log(formatStorageInspection(options));
}

export function getStorageMigrationNotImplementedMessage(): string {
  return (
    'Write-capable storage migration is not implemented yet. ' +
    'Rerun with --dry-run to inspect the migration plan.'
  );
}

export function formatStorageMigrationPlan(
  options: StorageConfig = {},
): string {
  const plan = planStorageMigration(options);
  const lines = [
    'Xurgo Atlas storage migration plan',
    'Mode: dry-run (read-only; no directories created, no files copied, no registry changes)',
    '',
    'Selected current roots:',
    `  configDir: ${plan.selected.configDir}`,
    `  dataDir: ${plan.selected.dataDir}`,
    `  source: ${plan.selected.sourceSummary}`,
    `  registry: ${plan.selected.registry.path}`,
    `  registry exists: ${formatYesNo(plan.selected.registry.exists)}`,
    `  registry project count: ${formatProjectCount(plan.selected.registry.projectCount)}`,
    `  runtime dir: ${plan.selected.runtime.runtimeDir}`,
    `  runtime dir exists: ${formatYesNo(plan.selected.runtime.runtimeDirExists)}`,
    '',
    'Legacy source candidate:',
    `  configDir: ${plan.source.configDir}`,
    `  dataDir: ${plan.source.dataDir}`,
    `  appears present: ${formatYesNo(plan.source.present)}`,
    `  registry exists: ${formatYesNo(plan.source.registry.exists)}`,
    `  registry project count: ${formatProjectCount(plan.source.registry.projectCount)}`,
    `  registry stored configDir: ${formatOptionalPath(plan.source.registry.storedConfigDir)}`,
    `  registry stored dataDir: ${formatOptionalPath(plan.source.registry.storedDataDir)}`,
    `  registry configDir mismatch: ${formatBooleanOrUnknown(plan.source.registry.configDirMismatch)}`,
    `  registry dataDir mismatch: ${formatBooleanOrUnknown(plan.source.registry.dataDirMismatch)}`,
    `  data dir exists: ${formatYesNo(plan.source.dataDirExists)}`,
    `  data dir populated: ${formatYesNo(plan.source.dataDirPopulated)}`,
    `  runtime artifacts present: ${formatYesNo(plan.source.runtime.presentArtifacts.length > 0)}`,
    '',
    'Atlas target candidate:',
    `  configDir: ${plan.target.configDir}`,
    `  dataDir: ${plan.target.dataDir}`,
    `  appears present: ${formatYesNo(plan.target.present)}`,
    `  registry exists: ${formatYesNo(plan.target.registry.exists)}`,
    `  registry project count: ${formatProjectCount(plan.target.registry.projectCount)}`,
    `  registry stored configDir: ${formatOptionalPath(plan.target.registry.storedConfigDir)}`,
    `  registry stored dataDir: ${formatOptionalPath(plan.target.registry.storedDataDir)}`,
    `  registry configDir mismatch: ${formatBooleanOrUnknown(plan.target.registry.configDirMismatch)}`,
    `  registry dataDir mismatch: ${formatBooleanOrUnknown(plan.target.registry.dataDirMismatch)}`,
    `  data dir exists: ${formatYesNo(plan.target.dataDirExists)}`,
    `  data dir populated: ${formatYesNo(plan.target.dataDirPopulated)}`,
    `  runtime artifacts present: ${formatYesNo(plan.target.runtime.presentArtifacts.length > 0)}`,
    '',
    ...formatListSection(
      'Classifications:',
      plan.classifications.map((classification) => formatMigrationClassification(classification)),
    ),
    ...formatListSection('Future copy actions:', plan.futureCopyActions),
    ...formatListSection('Future skip / leave-untouched actions:', plan.futureSkipActions),
    ...formatListSection('Blockers:', plan.blockers),
    ...formatListSection('Warnings:', plan.warnings),
    `Next recommended action: ${plan.nextAction}`,
    'No changes were made. This command did not create, copy, modify, or delete any files.',
  ];

  if (plan.projectIdConflicts.length > 0) {
    lines.splice(
      lines.indexOf('Future copy actions:'),
      0,
      'Project ID conflicts:',
      ...plan.projectIdConflicts.map((projectId) => `  - ${projectId}`),
      '',
    );
  }

  return lines.join('\n');
}

export async function storageMigrateCommand(
  options: StorageConfig = {},
  dryRun = false,
): Promise<void> {
  if (!dryRun) {
    throw new Error(getStorageMigrationNotImplementedMessage());
  }

  console.log(formatStorageMigrationPlan(options));
}
