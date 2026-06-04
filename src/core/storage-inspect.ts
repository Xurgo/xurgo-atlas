import * as fs from 'node:fs';

import { StoragePaths, type ResolvedStorageRoots, type StorageConfig, resolveStorageRoots } from './storage.js';

export interface RegistryInspection {
  path: string;
  exists: boolean;
  projectCount: number | null;
  readError: string | null;
}

export interface RuntimeArtifactInspection {
  runtimeDir: string;
  runtimeDirExists: boolean;
  pidFile: string;
  pidFileExists: boolean;
  logFile: string;
  logFileExists: boolean;
}

export interface StorageNamespaceInspection {
  label: 'atlas' | 'legacy';
  configDir: string;
  dataDir: string;
  registry: RegistryInspection;
  dataDirExists: boolean;
  dataDirPopulated: boolean;
  present: boolean;
}

export interface SelectedStorageInspection {
  configDir: string;
  dataDir: string;
  configSource: ResolvedStorageRoots['configSource'];
  dataSource: ResolvedStorageRoots['dataSource'];
  sourceSummary: string;
  registry: RegistryInspection;
  runtime: RuntimeArtifactInspection;
}

export interface StorageInspectionReport {
  selected: SelectedStorageInspection;
  atlas: StorageNamespaceInspection;
  legacy: StorageNamespaceInspection;
  bothPresent: boolean;
  diagnostics: ResolvedStorageRoots['diagnostics'];
}

function inspectRegistry(registryPath: string): RegistryInspection {
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as { projects?: unknown };
    const projectCount = parsed.projects && typeof parsed.projects === 'object'
      ? Object.keys(parsed.projects as Record<string, unknown>).length
      : 0;

    return {
      path: registryPath,
      exists: true,
      projectCount,
      readError: null,
    };
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return {
        path: registryPath,
        exists: false,
        projectCount: null,
        readError: null,
      };
    }

    return {
      path: registryPath,
      exists: true,
      projectCount: null,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function inspectRuntimeArtifacts(storage: StoragePaths): RuntimeArtifactInspection {
  const runtimeDir = storage.runtimeDir();
  const pidFile = storage.daemonPidFilePath();
  const logFile = storage.daemonLogPath();

  return {
    runtimeDir,
    runtimeDirExists: isDirectory(runtimeDir),
    pidFile,
    pidFileExists: fs.existsSync(pidFile),
    logFile,
    logFileExists: fs.existsSync(logFile),
  };
}

function summarizeSelectedSource(
  resolved: Pick<ResolvedStorageRoots, 'configSource' | 'dataSource'>,
): string {
  if (resolved.configSource === resolved.dataSource) {
    return resolved.configSource;
  }

  return `config=${resolved.configSource}, data=${resolved.dataSource}`;
}

export function inspectManagedStorage(
  config: StorageConfig = {},
): StorageInspectionReport {
  const resolved = resolveStorageRoots(config);
  const storage = new StoragePaths({
    configDir: resolved.configDir,
    dataDir: resolved.dataDir,
  });

  return {
    selected: {
      configDir: resolved.configDir,
      dataDir: resolved.dataDir,
      configSource: resolved.configSource,
      dataSource: resolved.dataSource,
      sourceSummary: summarizeSelectedSource(resolved),
      registry: inspectRegistry(storage.registryPath()),
      runtime: inspectRuntimeArtifacts(storage),
    },
    atlas: {
      label: 'atlas',
      configDir: resolved.discovery.atlas.configDir,
      dataDir: resolved.discovery.atlas.dataDir,
      registry: inspectRegistry(resolved.discovery.atlas.registryPath),
      dataDirExists: resolved.discovery.atlas.dataDirExists,
      dataDirPopulated: resolved.discovery.atlas.dataDirPopulated,
      present: resolved.discovery.atlas.present,
    },
    legacy: {
      label: 'legacy',
      configDir: resolved.discovery.legacy.configDir,
      dataDir: resolved.discovery.legacy.dataDir,
      registry: inspectRegistry(resolved.discovery.legacy.registryPath),
      dataDirExists: resolved.discovery.legacy.dataDirExists,
      dataDirPopulated: resolved.discovery.legacy.dataDirPopulated,
      present: resolved.discovery.legacy.present,
    },
    bothPresent: resolved.discovery.atlas.present && resolved.discovery.legacy.present,
    diagnostics: resolved.diagnostics,
  };
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
