import * as path from 'node:path';
import { ProjectResolutionError } from './project-resolution.js';

export type ArtifactCapabilityTier =
  | 'discover_only'
  | 'register_and_index'
  | 'validate'
  | 'proposal_export'
  | 'first_class_supported'
  | 'deferred_or_unsafe';

export type ArtifactClass =
  | 'instruction_only'
  | 'declarative_configuration'
  | 'executable_package'
  | 'tool_native_root_namespace';

export type ArtifactDiscoveryStatus = 'present' | 'absent';

export type ToolNativeRootIdentity =
  | 'agents_md_interoperability'
  | 'claude_code_root'
  | 'cursor_root'
  | 'gemini_cli_root'
  | 'windsurf_root'
  | 'kiro_root'
  | 'cline_root'
  | 'roo_code_root'
  | 'opencode_root'
  | 'kilo_code_root';

export interface HarnessDiscoveryDescriptor {
  adapterId: string;
  artifactClass: ArtifactClass;
  capabilityTier: ArtifactCapabilityTier;
  discoveryStatus: ArtifactDiscoveryStatus;
  present: boolean;
  projectRelativePath: string;
  toolNativeRootId: ToolNativeRootIdentity;
}

export interface HarnessDiscoveryCatalogEntry {
  adapterId: string;
  artifactClass: ArtifactClass;
  capabilityTier: ArtifactCapabilityTier;
  projectRelativePath: string;
  safeDiscovery: 'exact_path_exists';
  toolNativeRootId: ToolNativeRootIdentity;
}

export interface HarnessDiscoverySnapshot {
  descriptors: HarnessDiscoveryDescriptor[];
}

export interface SafeDirectoryPresenceChecker {
  assertProjectRootDirectory(projectRoot: string): Promise<void>;
  pathExists(projectRoot: string, projectRelativePath: string): Promise<boolean>;
}

export const HARNESS_DISCOVERY_CATALOG: readonly HarnessDiscoveryCatalogEntry[] = [
  {
    adapterId: 'atlas.interop.agents-md',
    artifactClass: 'instruction_only',
    capabilityTier: 'discover_only',
    projectRelativePath: 'AGENTS.md',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'agents_md_interoperability',
  },
  {
    adapterId: 'anthropic.claude-code',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.claude',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'claude_code_root',
  },
  {
    adapterId: 'cursor.cursor',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.cursor',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'cursor_root',
  },
  {
    adapterId: 'google.gemini-cli',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.gemini',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'gemini_cli_root',
  },
  {
    adapterId: 'codeium.windsurf',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.windsurf',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'windsurf_root',
  },
  {
    adapterId: 'amazon.kiro',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.kiro',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'kiro_root',
  },
  {
    adapterId: 'cline.cline',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.cline',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'cline_root',
  },
  {
    adapterId: 'roo-code.roo-code',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.roo',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'roo_code_root',
  },
  {
    adapterId: 'sst.opencode',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.opencode',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'opencode_root',
  },
  {
    adapterId: 'kilocode.kilo-code',
    artifactClass: 'tool_native_root_namespace',
    capabilityTier: 'deferred_or_unsafe',
    projectRelativePath: '.kilocode',
    safeDiscovery: 'exact_path_exists',
    toolNativeRootId: 'kilo_code_root',
  },
];

export async function snapshotHarnessDiscovery(
  projectRoot: string,
  presenceChecker: SafeDirectoryPresenceChecker,
): Promise<HarnessDiscoverySnapshot> {
  const resolvedRoot = path.resolve(projectRoot);
  await presenceChecker.assertProjectRootDirectory(resolvedRoot);

  const descriptors = await Promise.all(
    HARNESS_DISCOVERY_CATALOG.map(async (entry) => {
      assertCatalogPath(entry.projectRelativePath);
      const present = await presenceChecker.pathExists(
        resolvedRoot,
        entry.projectRelativePath,
      );

      return {
        adapterId: entry.adapterId,
        artifactClass: entry.artifactClass,
        capabilityTier: entry.capabilityTier,
        discoveryStatus: present ? 'present' : 'absent',
        present,
        projectRelativePath: entry.projectRelativePath,
        toolNativeRootId: entry.toolNativeRootId,
      } satisfies HarnessDiscoveryDescriptor;
    }),
  );

  return { descriptors };
}

function assertCatalogPath(projectRelativePath: string): void {
  if (
    path.isAbsolute(projectRelativePath) ||
    projectRelativePath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(
      `Unsafe harness discovery catalog path "${projectRelativePath}"`,
    );
  }
}

export function buildSafeDirectoryPresenceChecker(
  operations: {
    assertProjectRootDirectory(projectRoot: string): Promise<void>;
    pathExists(absolutePath: string): Promise<boolean>;
  },
): SafeDirectoryPresenceChecker {
  return {
    async assertProjectRootDirectory(projectRoot: string): Promise<void> {
      await operations.assertProjectRootDirectory(projectRoot);
    },
    async pathExists(
      projectRoot: string,
      projectRelativePath: string,
    ): Promise<boolean> {
      assertCatalogPath(projectRelativePath);
      return operations.pathExists(path.join(projectRoot, projectRelativePath));
    },
  };
}

export function createInvalidProjectRootError(projectRoot: string): ProjectResolutionError {
  return new ProjectResolutionError(
    `Project root "${projectRoot}" does not exist or is not a directory.`,
  );
}
