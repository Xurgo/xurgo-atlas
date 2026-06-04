import { inspectManagedStorage } from '../core/storage-inspect.js';
import type { StorageConfig } from '../core/storage.js';

export function getStorageUsageText(): string {
  return `
Inspect Xurgo Atlas managed storage roots.
Legacy alias: docu-guard (temporary)

USAGE:
  xurgo-atlas storage inspect [options]

SUBCOMMANDS:
  inspect
    Show Atlas-vs-legacy storage discovery, selected roots, registry state,
    and runtime artifact presence without migrating or modifying files.
    --config-dir <path>   Inspect with an explicit config directory override
    --data-dir <path>     Inspect with an explicit data directory override

EXAMPLES:
  xurgo-atlas storage inspect
  xurgo-atlas storage inspect --config-dir ~/.config/xurgo-atlas --data-dir ~/.local/share/xurgo-atlas

This command is read-only. It does not migrate, create, update, or delete storage files.
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
