import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';

/**
 * Default policy configuration used when .docs-policy.yml does not exist.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  protected_paths: [
    'STATUS.md',
    'AGENTS.md',
    '.docs-policy.yml',
    'docs/**',
    'docs/spec/**',
    'docs/implementation-checklist.md',
    'docs/architecture.md',
    'docs/decisions/**',
  ],
  write_mode: {
    default: 'propose_patch_only',
    protected: 'approval_required',
  },
  forbidden_operations: [
    'silent_delete',
    'whole_file_replace_without_base_revision',
    'overwrite_without_diff',
    'delete_protected_doc_without_approval',
  ],
  required_metadata: ['intent', 'baseRevision', 'summary'],
  branching: {
    agent_branches: true,
    merge_to_main_requires: 'approval',
  },
  risk_rules: {
    large_deletion_percent: 25,
    whole_file_replacement_requires_approval: true,
    heading_removal_requires_approval: true,
    protected_file_change_requires_approval: true,
  },
};

const REQUIRED_PROTECTED_PATHS = [
  'STATUS.md',
  'AGENTS.md',
  '.docs-policy.yml',
];

export interface PolicyConfig {
  protected_paths: string[];
  write_mode: {
    default: string;
    protected: string;
  };
  forbidden_operations: string[];
  required_metadata: string[];
  branching: {
    agent_branches: boolean;
    merge_to_main_requires: string;
  };
  risk_rules: {
    large_deletion_percent: number;
    whole_file_replacement_requires_approval: boolean;
    heading_removal_requires_approval: boolean;
    protected_file_change_requires_approval: boolean;
  };
}

export class Policy {
  private config: PolicyConfig;

  constructor(config?: Partial<PolicyConfig>) {
    this.config = {
      ...DEFAULT_POLICY,
      ...config,
      protected_paths: mergeProtectedPaths(config?.protected_paths),
    };
  }

  static async load(projectRoot: string): Promise<Policy> {
    const policyPath = path.join(projectRoot, '.docs-policy.yml');
    try {
      const content = await fs.promises.readFile(policyPath, 'utf-8');
      const parsed = YAML.parse(content) as Partial<PolicyConfig> | null;
      return new Policy(parsed ?? {});
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Policy();
      }
      throw err;
    }
  }

  static async createDefault(projectRoot: string): Promise<Policy> {
    const policyPath = path.join(projectRoot, '.docs-policy.yml');
    const content = YAML.stringify(DEFAULT_POLICY, { indent: 2 });
    await fs.promises.writeFile(policyPath, content, 'utf-8');
    return new Policy();
  }

  getConfig(): PolicyConfig {
    return this.config;
  }

  isPathProtected(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    for (const pattern of this.config.protected_paths) {
      if (this.matchGlob(normalized, pattern)) {
        return true;
      }
    }
    return false;
  }

  isOperationForbidden(operation: string): boolean {
    return this.config.forbidden_operations.includes(operation);
  }

  getRequiredMetadata(): string[] {
    return this.config.required_metadata;
  }

  getRiskRules() {
    return this.config.risk_rules;
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  }
}

function mergeProtectedPaths(configuredPaths?: string[]): string[] {
  const merged = [
    ...REQUIRED_PROTECTED_PATHS,
    ...(configuredPaths ?? DEFAULT_POLICY.protected_paths),
  ];
  return [...new Set(merged)];
}
