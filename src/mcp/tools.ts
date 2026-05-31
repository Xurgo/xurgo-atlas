import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from '../utils.js';
import { Project } from '../core/project.js';
import { validatePatch, PatchProposal } from '../core/patch.js';
import { isPathTraversal } from '../core/patch.js';

// ── Schemas ───────────────────────────────────────────────────────────

const ProjectIdSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

const ListDocsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
});

const ReadDocSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  path: z.string().min(1, 'path is required'),
  branch: z.string().optional().default('main'),
});

const CreateBranchSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().min(1, 'branch name is required'),
  from: z.string().optional().default('main'),
});

const ProposePatchSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().min(1, 'branch is required'),
  path: z.string().min(1, 'path is required'),
  baseRevision: z.string().min(1, 'baseRevision is required'),
  patch: z.string().min(1, 'patch is required'),
  intent: z.string().min(1, 'intent is required'),
  summary: z.string().min(1, 'summary is required'),
});

const PreviewDiffSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  proposalId: z.string().min(1, 'proposalId is required'),
});

const CommitPatchSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  proposalId: z.string().min(1, 'proposalId is required'),
  actor: z.string().optional().default('unknown'),
  riskOverride: z.string().optional(),
});

const HistorySchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  path: z.string().min(1, 'path is required'),
  branch: z.string().optional(),
  limit: z.number().int().positive().optional().default(50),
});

const RestoreFileSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  path: z.string().min(1, 'path is required'),
  revision: z.string().min(1, 'revision is required'),
  branch: z.string().optional().default('main'),
  intent: z.string().min(1, 'intent is required'),
});

const ExportSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
  targetDir: z.string().optional(),
});

// ── Tool Registration ────────────────────────────────────────────────

export function registerTools(server: Server, project: Project): void {
  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'docs.list',
          description: 'List all tracked documentation files in a branch',
          inputSchema: zodToJsonSchema(ListDocsSchema),
        },
        {
          name: 'docs.read',
          description: 'Read a documentation file from a specific branch',
          inputSchema: zodToJsonSchema(ReadDocSchema),
        },
        {
          name: 'docs.create_branch',
          description:
            'Create a new branch for making documentation changes',
          inputSchema: zodToJsonSchema(CreateBranchSchema),
        },
        {
          name: 'docs.propose_patch',
          description:
            'Propose a patch to a documentation file. Validates the patch against policy and checks for risks. Does not apply the change — use docs.commit_patch to finalize.',
          inputSchema: zodToJsonSchema(ProposePatchSchema),
        },
        {
          name: 'docs.preview_diff',
          description:
            'Preview the diff for a previously proposed patch by proposalId. Returns the diff, risk level, and approval requirements without committing.',
          inputSchema: zodToJsonSchema(PreviewDiffSchema),
        },
        {
          name: 'docs.commit_patch',
          description:
            'Commit a previously proposed patch by proposalId. Re-validates the base revision before applying. Requires riskOverride: "accept" for high-risk patches.',
          inputSchema: zodToJsonSchema(CommitPatchSchema),
        },
        {
          name: 'docs.history',
          description:
            'View the Git history for a documentation file',
          inputSchema: zodToJsonSchema(HistorySchema),
        },
        {
          name: 'docs.restore_file',
          description:
            'Restore a file to a previous revision from history',
          inputSchema: zodToJsonSchema(RestoreFileSchema),
        },
        {
          name: 'docs.export',
          description:
            'Export documentation from a branch to a target directory',
          inputSchema: zodToJsonSchema(ExportSchema),
        },
      ],
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'docs.list':
          return await handleList(project, args as Record<string, unknown>);
        case 'docs.read':
          return await handleRead(project, args as Record<string, unknown>);
        case 'docs.create_branch':
          return await handleCreateBranch(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.propose_patch':
          return await handleProposePatch(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.preview_diff':
          return await handlePreviewDiff(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.commit_patch':
          return await handleCommitPatch(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.history':
          return await handleHistory(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.restore_file':
          return await handleRestoreFile(
            project,
            args as Record<string, unknown>,
          );
        case 'docs.export':
          return await handleExport(
            project,
            args as Record<string, unknown>,
          );
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
}

// ── Tool Handlers ─────────────────────────────────────────────────────

async function handleList(project: Project, rawArgs: Record<string, unknown>) {
  const args = ListDocsSchema.parse(rawArgs);
  const filePaths = await project.getTrackedFiles(args.branch);
  const branchRevision = await project.gitStore.getBranchHead(args.branch);

  // Enrich each file with revision and protected status
  const files = await Promise.all(
    filePaths.map(async (filePath) => ({
      path: filePath,
      revision: await project.gitStore.getFileRevision(args.branch, filePath),
      protected: project.policy.isPathProtected(filePath),
    })),
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            branch: args.branch,
            revision: branchRevision,
            files,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleRead(project: Project, rawArgs: Record<string, unknown>) {
  const args = ReadDocSchema.parse(rawArgs);

  // Validate path
  if (isPathTraversal(args.path)) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Path traversal detected: "${args.path}" is outside the project scope`,
          }),
        },
      ],
      isError: true,
    };
  }

  const { content, revision } = await project.readFile(
    args.branch,
    args.path,
  );

  if (content === null) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `File "${args.path}" not found on branch "${args.branch}"`,
            projectId: project.projectId,
            path: args.path,
            branch: args.branch,
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            path: args.path,
            branch: args.branch,
            revision,
            content,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleCreateBranch(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = CreateBranchSchema.parse(rawArgs);

  // Check if branch already exists
  const exists = await project.gitStore.branchExists(args.branch);
  if (exists) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Branch "${args.branch}" already exists`,
            projectId: project.projectId,
            branch: args.branch,
          }),
        },
      ],
      isError: true,
    };
  }

  // Check source branch exists
  const sourceExists = await project.gitStore.branchExists(args.from);
  if (!sourceExists) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Source branch "${args.from}" does not exist`,
            projectId: project.projectId,
            branch: args.branch,
            from: args.from,
          }),
        },
      ],
      isError: true,
    };
  }

  await project.gitStore.createBranch(args.branch, args.from);
  const branchHead = await project.gitStore.getBranchHead(args.branch);

  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: args.branch,
    path: '.branch',
    tool_name: 'create_branch',
    intent: `Create branch "${args.branch}" from "${args.from}"`,
    summary: `Created branch "${args.branch}" from "${args.from}"`,
    result_revision: branchHead ?? undefined,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            branch: args.branch,
            from: args.from,
            created: true,
            revision: branchHead,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleProposePatch(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = ProposePatchSchema.parse(rawArgs);

  const patchProposal: PatchProposal = {
    projectId: args.projectId,
    branch: args.branch,
    path: args.path,
    baseRevision: args.baseRevision,
    patch: args.patch,
    intent: args.intent,
    summary: args.summary,
  };

  const validation = await validatePatch(
    project.policy,
    project.gitStore,
    patchProposal,
  );

  if (!validation.valid) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: validation.error,
              projectId: project.projectId,
              path: args.path,
              branch: args.branch,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const riskLevel = validation.risk?.highRisk ? 'high' : 'low';
  const requiresApproval = !!validation.risk?.highRisk;

  // Store the proposal
  const stored = project.eventLog.storeProposal({
    project_id: project.projectId,
    branch: args.branch,
    path: args.path,
    base_revision: args.baseRevision,
    patch: args.patch,
    intent: args.intent,
    summary: args.summary,
    risk_level: riskLevel,
    requires_approval: requiresApproval,
  });

  // Log the proposal event
  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: args.branch,
    path: args.path,
    tool_name: 'propose_patch',
    intent: args.intent,
    summary: args.summary,
    base_revision: args.baseRevision,
    risk_level: riskLevel,
    diff: args.patch,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            proposalId: stored.id,
            valid: true,
            riskLevel,
            requiresApproval,
            summary: args.summary,
            changedFiles: [args.path],
            projectId: project.projectId,
            branch: args.branch,
            message: 'Patch proposal stored. Use docs.preview_diff to review or docs.commit_patch to apply.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handlePreviewDiff(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = PreviewDiffSchema.parse(rawArgs);

  // Look up the stored proposal
  const stored = project.eventLog.getProposal(args.proposalId);
  if (!stored) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Proposal "${args.proposalId}" not found`,
            projectId: project.projectId,
          }),
        },
      ],
      isError: true,
    };
  }

  if (stored.status !== 'pending') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Proposal "${args.proposalId}" has status "${stored.status}" and cannot be previewed`,
            proposalId: stored.id,
            status: stored.status,
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            proposalId: stored.id,
            diff: stored.patch,
            riskLevel: stored.risk_level,
            requiresApproval: stored.requires_approval,
            projectId: project.projectId,
            path: stored.path,
            branch: stored.branch,
            summary: stored.summary,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleCommitPatch(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = CommitPatchSchema.parse(rawArgs);

  // Look up the stored proposal
  const stored = project.eventLog.getProposal(args.proposalId);
  if (!stored) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Proposal "${args.proposalId}" not found`,
            projectId: project.projectId,
          }),
        },
      ],
      isError: true,
    };
  }

  if (stored.status !== 'pending') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Proposal "${args.proposalId}" has status "${stored.status}" and cannot be committed`,
            proposalId: stored.id,
            status: stored.status,
          }),
        },
      ],
      isError: true,
    };
  }

  // Re-validate the patch (re-checks base revision, may have gone stale)
  const patchProposal: PatchProposal = {
    projectId: stored.project_id,
    branch: stored.branch,
    path: stored.path,
    baseRevision: stored.base_revision,
    patch: stored.patch,
    intent: stored.intent,
    summary: stored.summary,
  };

  const validation = await validatePatch(
    project.policy,
    project.gitStore,
    patchProposal,
  );

  if (!validation.valid) {
    // Mark the proposal as stale so the agent knows to re-propose
    project.eventLog.updateProposalStatus(stored.id, 'stale');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: validation.error,
              proposalId: stored.id,
              projectId: project.projectId,
              path: stored.path,
              branch: stored.branch,
              message: 'Proposal marked as stale. Re-read the file and create a new proposal.',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // If high risk and no override, require explicit confirmation
  const isHighRisk = validation.risk?.highRisk ?? false;
  if (isHighRisk && args.riskOverride !== 'accept') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: 'High-risk patch requires riskOverride: "accept" to proceed',
              proposalId: stored.id,
              projectId: project.projectId,
              path: stored.path,
              branch: stored.branch,
              riskLevel: 'high',
              reasons: validation.risk?.reasons ?? [],
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Commit the changes
  const commitResult = await project.gitStore.applyPatchAndCommit(
    stored.branch,
    stored.path,
    stored.patch,
    stored.summary,
    stored.base_revision,
  );

  // Mark proposal as committed
  project.eventLog.updateProposalStatus(stored.id, 'committed');

  // Log the commit event
  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: stored.branch,
    path: stored.path,
    actor: args.actor,
    tool_name: 'commit_patch',
    intent: stored.intent,
    summary: stored.summary,
    base_revision: stored.base_revision,
    result_revision: commitResult.hash,
    risk_level: isHighRisk ? 'high' : 'low',
    diff: stored.patch,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            proposalId: stored.id,
            commit: commitResult.hash,
            changedFiles: [stored.path],
            projectId: project.projectId,
            branch: stored.branch,
            message: 'Patch committed successfully',
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleHistory(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = HistorySchema.parse(rawArgs);

  // Get history from both Git and event log
  const gitHistory = await project.gitStore.getHistory(args.path, args.limit);
  const eventHistory = project.eventLog.getHistoryForPath(
    project.projectId,
    args.path,
    args.limit,
  );

  // Merge into a unified history array matching the PRD spec format
  const history = mergeHistory(gitHistory, eventHistory);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            path: args.path,
            history,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * Merge Git history and event log entries into a unified, deduplicated,
 * sorted history array. Deduplication is by revision hash (preferring
 * the more descriptive source). Entries are sorted newest-first.
 */
/** Entry shape accepted by mergeHistory from the Git store. */
export interface GitHistoryEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/** Entry shape accepted by mergeHistory from the event log. */
export interface EventHistoryEntry {
  id?: string;
  result_revision?: string;
  created_at?: string;
  actor?: string;
  summary?: string;
  tool_name?: string;
}

export function mergeHistory(
  gitHistory: GitHistoryEntry[],
  eventHistory: EventHistoryEntry[],
): Array<{
  revision: string;
  timestamp: string;
  actor: string;
  summary: string;
}> {
  const seen = new Set<string>();
  const merged: Array<{
    revision: string;
    timestamp: string;
    actor: string;
    summary: string;
  }> = [];

  // Git entries first (preferred source)
  for (const entry of gitHistory) {
    const revision = entry.hash;
    if (!seen.has(revision)) {
      seen.add(revision);
      merged.push({
        revision,
        timestamp: entry.date,
        actor: entry.author,
        summary: entry.message,
      });
    }
  }

  // Event log entries (add any not already covered by git)
  for (const entry of eventHistory) {
    const revision = entry.result_revision ?? entry.id ?? '';
    if (revision && !seen.has(revision)) {
      seen.add(revision);
      merged.push({
        revision,
        timestamp: entry.created_at ?? '',
        actor: entry.actor ?? entry.tool_name ?? 'unknown',
        summary: entry.summary ?? '',
      });
    }
  }

  // Sort newest-first by timestamp
  merged.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return merged;
}

async function handleRestoreFile(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = RestoreFileSchema.parse(rawArgs);

  // Validate path
  if (isPathTraversal(args.path)) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Path traversal detected: "${args.path}" is outside the project scope`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Validate the revision exists
  const content = await project.gitStore.readFileAtRevision(
    args.revision,
    args.path,
  );
  if (content === null) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Revision "${args.revision}" not found for file "${args.path}"`,
            projectId: project.projectId,
            path: args.path,
            revision: args.revision,
          }),
        },
      ],
      isError: true,
    };
  }

  const result = await project.gitStore.restoreFile(
    args.branch,
    args.path,
    args.revision,
  );

  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: args.branch,
    path: args.path,
    tool_name: 'restore_file',
    intent: args.intent,
    summary: `Restored "${args.path}" to revision ${args.revision.slice(0, 8)}`,
    result_revision: result.hash,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            restored: true,
            path: args.path,
            branch: args.branch,
            commit: result.hash,
            projectId: project.projectId,
            revision: args.revision,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleExport(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = ExportSchema.parse(rawArgs);

  const targetDir = args.targetDir ?? project.root;

  const exportedFiles = await project.gitStore.exportBranch(
    args.branch,
    targetDir,
  );

  const revision = await project.gitStore.getBranchHead(args.branch);

  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: args.branch,
    path: '.export',
    tool_name: 'export',
    intent: `Export documentation from branch "${args.branch}"`,
    summary: `Exported ${exportedFiles.length} files from "${args.branch}" to "${targetDir}"`,
    result_revision: revision ?? undefined,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            exported: true,
            branch: args.branch,
            files: exportedFiles,
            projectId: project.projectId,
            targetDir,
            revision,
          },
          null,
          2,
        ),
      },
    ],
  };
}
