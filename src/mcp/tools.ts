import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from '../utils.js';
import { Project } from '../core/project.js';
import { ProposalMetadata, StoredProposal } from '../core/events.js';
import { ProjectResolver } from './types.js';
import { validatePatch, PatchProposal, PatchValidation } from '../core/patch.js';
import { isPathTraversal } from '../core/patch.js';
import { assessPatchRisk } from '../core/risk.js';
import {
  createUnifiedDiffForNewFile,
  createUnifiedDiffForReplacement,
} from '../core/unified-diff.js';
import YAML from 'yaml';

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
  maxChars: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional().default(0),
});

const ReadSectionSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  path: z.string().min(1, 'path is required'),
  branch: z.string().optional().default('main'),
  revision: z.string().optional(),
  heading: z.string().min(1, 'heading is required'),
  level: z.number().int().min(1).max(6).optional(),
  occurrence: z.number().int().positive().optional().default(1),
  includeHeading: z.boolean().optional().default(true),
  maxChars: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional().default(0),
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
  patch: z
    .string()
    .min(1, 'patch is required')
    .describe(
      'Standard unified diff patch text only. Required format uses ---/+++ file headers and @@ hunks. Do not send apply_patch blocks such as *** Begin Patch or prose-only patch summaries.',
    ),
  intent: z.string().min(1, 'intent is required'),
  summary: z.string().min(1, 'summary is required'),
});

const ProposeDocumentSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
  mode: z.enum(['create']),
  path: z.string().min(1, 'path is required'),
  content: z.string().refine((value) => value.trim().length > 0, {
    message: 'content is required',
  }),
  document: z.object({
    role: z.string().refine((value) => value.trim().length > 0, {
      message: 'document.role is required',
    }),
    summary: z.string().refine((value) => value.trim().length > 0, {
      message: 'document.summary is required',
    }),
    priority: z.string().optional(),
  }),
  intent: z.string().refine((value) => value.trim().length > 0, {
    message: 'intent is required',
  }),
  summary: z.string().refine((value) => value.trim().length > 0, {
    message: 'summary is required',
  }),
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

const StatusSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
  maxChars: z.number().int().positive().optional().default(4000),
});

const ManifestSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
  maxDocuments: z.number().int().positive().optional().default(100),
  includeRaw: z.boolean().optional().default(false),
  validatePaths: z.boolean().optional().default(true),
});

const ContextPackSectionSchema = z.object({
  path: z.string().min(1, 'path is required'),
  heading: z.string().min(1, 'heading is required'),
  level: z.number().int().min(1).max(6).optional(),
  occurrence: z.number().int().positive().optional().default(1),
  includeHeading: z.boolean().optional().default(true),
  maxChars: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional().default(0),
});

const ContextPackSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  branch: z.string().optional().default('main'),
  revision: z.string().optional(),
  maxChars: z.number().int().positive().optional(),
  includeStatus: z.boolean().optional().default(true),
  includeAgents: z.boolean().optional().default(true),
  includeManifest: z.boolean().optional().default(true),
  paths: z.array(z.string().min(1)).optional().default([]),
  sections: z.array(ContextPackSectionSchema).optional().default([]),
  maxDocuments: z.number().int().positive().optional(),
});

// ── Tool Registration ────────────────────────────────────────────────

/**
 * Register all MCP tools on the server.
 *
 * Accepts either a single Project (stdio mode) or a ProjectResolver
 * function (daemon mode). In daemon mode, the project is resolved
 * per-request based on the `projectId` argument.
 */
export function registerTools(
  server: Server,
  projectOrResolver: Project | ProjectResolver,
): void {
  // Determine if we're in resolver mode (daemon) or single-project mode (stdio)
  const isResolver = typeof projectOrResolver === 'function';

  // List tools — returns the same tools regardless of mode
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'docs.list',
          description: 'List all Atlas-owned managed documentation files in a branch',
          inputSchema: zodToJsonSchema(ListDocsSchema),
        },
        {
          name: 'docs.read',
          description: 'Read a documentation file from a specific branch. Supports bounded reads with maxChars and offset for token-efficient access. Returns content, revision, truncation status, and character counts.',
          inputSchema: zodToJsonSchema(ReadDocSchema),
        },
        {
          name: 'docs.read_section',
          description: 'Read one Markdown section from a documentation file by ATX heading. Ignores headings in fenced code blocks, includes child subsections, and supports maxChars/offset bounded reads.',
          inputSchema: zodToJsonSchema(ReadSectionSchema),
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
            'Propose a patch to a documentation file. The patch field must be a standard unified diff with ---/+++ file headers and @@ hunks; apply_patch blocks such as "*** Begin Patch" are rejected. Validates the patch against policy and checks for risks. Does not apply the change — use docs.commit_patch to finalize.',
          inputSchema: zodToJsonSchema(ProposePatchSchema),
        },
        {
          name: 'docs.propose_document',
          description:
            'Propose creation of a new Atlas-managed Markdown document under docs/atlas/** and the matching docs/manifest.yml entry. Stores a previewable two-file proposal that is committed through docs.commit_patch.',
          inputSchema: zodToJsonSchema(ProposeDocumentSchema),
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
        {
          name: 'docs.status',
          description:
            'Read the STATUS.md project front page. Returns compact orientation: front matter, body excerpt, revision, and truncation status. Use this instead of docs.read for STATUS.md to get structured front matter. Respects maxChars to limit response size.',
          inputSchema: zodToJsonSchema(StatusSchema),
        },
        {
          name: 'docs.manifest',
          description:
            'Read docs/manifest.yml as a compact machine-readable project document map. Returns parsed YAML (JSON), revision, optional path validation, and optional raw YAML. Does not read full document bodies. Use this for project orientation instead of docs.list + multiple docs.read calls.',
          inputSchema: zodToJsonSchema(ManifestSchema),
        },
        {
          name: 'docs.context_pack',
          description:
            'Assemble a token-efficient project orientation pack from STATUS.md, AGENTS.md, docs/manifest.yml, requested sections, requested paths, and a small manifest-guided document set. Supports a total maxChars budget and structured missing-item reporting.',
          inputSchema: zodToJsonSchema(ContextPackSchema),
        },
      ],
    };
  });

  // Call tool handler — resolve project per-request in daemon mode
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawParams } = request.params;
    const rawArgs = (rawParams as Record<string, unknown>) || {};

    try {
      // Resolve the project for this request
      const project = await resolveProjectForRequest(
        rawArgs,
        isResolver,
        projectOrResolver,
      );

      // Inject the resolved projectId into args if not present
      // (e.g., when a default project was resolved in daemon mode)
      if (!rawArgs['projectId']) {
        rawArgs['projectId'] = project.projectId;
      }

      switch (name) {
        case 'docs.list':
          return await handleList(project, rawArgs);
        case 'docs.read':
          return await handleRead(project, rawArgs);
        case 'docs.read_section':
          return await handleReadSection(project, rawArgs);
        case 'docs.create_branch':
          return await handleCreateBranch(project, rawArgs);
        case 'docs.propose_patch':
          return await handleProposePatch(project, rawArgs);
        case 'docs.propose_document':
          return await handleProposeDocument(project, rawArgs);
        case 'docs.preview_diff':
          return await handlePreviewDiff(project, rawArgs);
        case 'docs.commit_patch':
          return await handleCommitPatch(project, rawArgs);
        case 'docs.history':
          return await handleHistory(project, rawArgs);
        case 'docs.restore_file':
          return await handleRestoreFile(project, rawArgs);
        case 'docs.export':
          return await handleExport(project, rawArgs);
        case 'docs.status':
          return await handleStatus(project, rawArgs);
        case 'docs.manifest':
          return await handleManifest(project, rawArgs);
        case 'docs.context_pack':
          return await handleContextPack(project, rawArgs);
        default:
          return {
            content: [
              { type: 'text', text: `Unknown tool: ${name}` },
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

/**
 * Resolve a Project for the given request arguments.
 *
 * In resolver mode (daemon): calls the resolver with the projectId from args
 *   (or empty string to trigger default resolution).
 * In single-project mode (stdio): returns the pre-loaded project directly.
 */
async function resolveProjectForRequest(
  rawArgs: Record<string, unknown>,
  isResolver: boolean,
  projectOrResolver: Project | ProjectResolver,
): Promise<Project> {
  if (isResolver) {
    const resolver = projectOrResolver as ProjectResolver;
    const projectId = (rawArgs['projectId'] as string) || '';
    return resolver(projectId);
  }

  // Single-project mode: use the pre-loaded project directly
  return projectOrResolver as Project;
}

// ── Tool Handlers ─────────────────────────────────────────────────────

async function handleList(project: Project, rawArgs: Record<string, unknown>) {
  const args = ListDocsSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }
  const filePaths = await project.getOwnedFiles(args.branch);
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

export async function handleRead(project: Project, rawArgs: Record<string, unknown>) {
  const args = ReadDocSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }

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

  if (!(await project.isPathOwned(args.branch, args.path))) {
    return ownedPathError(project.projectId, args.path, args.branch);
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

  // Apply bounded read (offset/maxChars)
  const totalChars = content.length;
  const offset = args.offset ?? 0;
  let sliced = content;
  let truncated = false;

  if (offset > 0) {
    sliced = sliced.slice(offset);
  }

  if (args.maxChars !== undefined && sliced.length > args.maxChars) {
    sliced = sliced.slice(0, args.maxChars);
    truncated = true;
  }

  const returnedChars = sliced.length;

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
            content: sliced,
            truncated,
            maxChars: args.maxChars ?? null,
            offset,
            returnedChars,
            totalChars,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export async function handleReadSection(project: Project, rawArgs: Record<string, unknown>) {
  const args = ReadSectionSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }

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

  if (!(await project.isPathOwned(args.branch, args.path))) {
    return ownedPathError(project.projectId, args.path, args.branch);
  }

  const readResult = args.revision
    ? {
        content: await project.gitStore.readFileAtRevision(args.revision, args.path),
        revision: args.revision,
      }
    : await project.readFile(args.branch, args.path);

  const { content, revision } = readResult;

  if (content === null) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: args.revision
              ? `File "${args.path}" not found at revision "${args.revision}"`
              : `File "${args.path}" not found on branch "${args.branch}"`,
            projectId: project.projectId,
            path: args.path,
            branch: args.branch,
            revision: args.revision ?? null,
          }),
        },
      ],
      isError: true,
    };
  }

  const section = findMarkdownSection(content, {
    heading: args.heading,
    level: args.level,
    occurrence: args.occurrence,
    includeHeading: args.includeHeading,
  });

  if (!section) {
    const availableHeadings = collectMarkdownHeadings(content)
      .filter((heading) => args.level === undefined || heading.level === args.level)
      .slice(0, 10)
      .map((heading) => ({
        heading: heading.text,
        level: heading.level,
        line: heading.line,
      }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: `Heading "${args.heading}" not found in "${args.path}"`,
              projectId: project.projectId,
              path: args.path,
              branch: args.branch,
              revision,
              heading: args.heading,
              level: args.level ?? null,
              occurrence: args.occurrence,
              availableHeadings,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const totalChars = section.content.length;
  const offset = args.offset ?? 0;
  let sliced = section.content;
  let truncated = false;

  if (offset > 0) {
    sliced = sliced.slice(offset);
  }

  if (args.maxChars !== undefined && sliced.length > args.maxChars) {
    sliced = sliced.slice(0, args.maxChars);
    truncated = true;
  }

  const returnedChars = sliced.length;

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
            heading: args.heading,
            matchedHeading: section.matchedHeading,
            level: section.level,
            occurrence: args.occurrence,
            startLine: section.startLine,
            endLine: section.endLine,
            content: sliced,
            truncated,
            maxChars: args.maxChars ?? null,
            offset,
            returnedChars,
            totalChars,
          },
          null,
          2,
        ),
      },
    ],
  };
}

interface MarkdownHeading {
  text: string;
  level: number;
  line: number;
  index: number;
}

interface MarkdownSection {
  matchedHeading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

function findMarkdownSection(
  content: string,
  options: {
    heading: string;
    level?: number;
    occurrence: number;
    includeHeading: boolean;
  },
): MarkdownSection | null {
  const lines = content.split('\n');
  const headings = collectMarkdownHeadings(content);
  const targetHeading = normalizeHeadingText(options.heading);
  let seen = 0;

  for (const heading of headings) {
    if (options.level !== undefined && heading.level !== options.level) {
      continue;
    }

    if (normalizeHeadingText(heading.text) !== targetHeading) {
      continue;
    }

    seen += 1;
    if (seen !== options.occurrence) {
      continue;
    }

    const nextHeading = headings.find(
      (candidate) =>
        candidate.index > heading.index && candidate.level <= heading.level,
    );
    const endIndex = nextHeading ? nextHeading.index : lines.length;
    const contentStartIndex = options.includeHeading ? heading.index : heading.index + 1;
    const sectionContent = lines.slice(contentStartIndex, endIndex).join('\n');

    return {
      matchedHeading: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine: nextHeading ? nextHeading.line - 1 : countMarkdownLines(content),
      content: sectionContent,
    };
  }

  return null;
}

function collectMarkdownHeadings(content: string): MarkdownHeading[] {
  const lines = content.split('\n');
  const headings: MarkdownHeading[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerRun = fenceMatch[1];
      const marker = markerRun[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: markerRun.length };
        return;
      }

      if (marker === fence.marker && markerRun.length >= fence.length) {
        fence = null;
        return;
      }
    }

    if (fence) {
      return;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/);
    if (!headingMatch) {
      return;
    }

    headings.push({
      text: normalizeHeadingText(headingMatch[2]),
      level: headingMatch[1].length,
      line: index + 1,
      index,
    });
  });

  return headings;
}

function normalizeHeadingText(text: string): string {
  return text
    .trim()
    .replace(/\s+#+\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function countMarkdownLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split('\n');
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
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

const MANIFEST_PATH = 'docs/manifest.yml';
const ATLAS_DOCS_PREFIX = 'docs/atlas/';

interface DocumentCreateProposalMetadata {
  role: string;
  summary: string;
  priority?: string;
}

interface ManifestState {
  content: string;
  revision: string;
  parsed: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
}

interface DocumentCreatePreparation {
  path: string;
  patch: string;
  manifestRevision: string;
  riskLevel: 'high' | 'low';
  requiresApproval: boolean;
  riskReasons: string[];
  changedFiles: string[];
}

export async function handleProposeDocument(
  project: Project,
  rawArgs: Record<string, unknown>,
) {
  const args = ProposeDocumentSchema.parse(rawArgs);

  if (args.document.priority !== undefined && args.document.priority.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: 'document.priority must not be empty',
              projectId: project.projectId,
              path: normalizeManagedPath(args.path),
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

  const normalizedDocument = {
    role: args.document.role.trim(),
    summary: args.document.summary.trim(),
    priority: args.document.priority?.trim() || undefined,
  };

  const prepared = await prepareDocumentCreateProposal(
    project,
    args.branch,
    args.path,
    args.content,
    normalizedDocument,
  );

  if (!prepared.valid) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: prepared.error,
              projectId: project.projectId,
              path: normalizeManagedPath(args.path),
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

  const metadata: ProposalMetadata = {
    kind: 'document_create',
    mode: 'create',
    changedFiles: prepared.changedFiles,
    baseRevisions: {
      [MANIFEST_PATH]: prepared.manifestRevision,
    },
    riskReasons: prepared.riskReasons,
  };

  const stored = project.eventLog.storeProposal({
    project_id: project.projectId,
    branch: args.branch,
    path: prepared.path,
    base_revision: prepared.manifestRevision,
    patch: prepared.patch,
    intent: args.intent,
    summary: args.summary,
    risk_level: prepared.riskLevel,
    requires_approval: prepared.requiresApproval,
    metadata,
  });

  project.eventLog.logEvent({
    project_id: project.projectId,
    branch: args.branch,
    path: prepared.path,
    tool_name: 'propose_document',
    intent: args.intent,
    summary: args.summary,
    base_revision: prepared.manifestRevision,
    risk_level: prepared.riskLevel,
    diff: prepared.patch,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            proposalId: stored.id,
            valid: true,
            riskLevel: prepared.riskLevel,
            requiresApproval: prepared.requiresApproval,
            summary: args.summary,
            changedFiles: prepared.changedFiles,
            projectId: project.projectId,
            branch: args.branch,
            message: 'Document proposal stored. Use docs.preview_diff to review or docs.commit_patch to apply.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function prepareDocumentCreateProposal(
  project: Project,
  branch: string,
  requestedPath: string,
  requestedContent: string,
  document: DocumentCreateProposalMetadata,
): Promise<
  | ({ valid: true } & DocumentCreatePreparation)
  | { valid: false; error: string }
> {
  const normalizedPath = normalizeManagedPath(requestedPath);
  const content = ensureTrailingNewline(requestedContent);

  const pathError = validateCreateDocumentPath(normalizedPath);
  if (pathError) {
    return { valid: false, error: pathError };
  }

  const branchExists = await project.gitStore.branchExists(branch);
  if (!branchExists) {
    return {
      valid: false,
      error: `Branch "${branch}" does not exist. Create it with docs.create_branch first.`,
    };
  }

  if (await project.gitStore.fileExists(branch, normalizedPath)) {
    return {
      valid: false,
      error: `File "${normalizedPath}" already exists on branch "${branch}"`,
    };
  }

  const manifestState = await readManifestState(project, branch);
  if (!manifestState.valid) {
    return manifestState;
  }

  const hasManifestPath = manifestState.documents.some(
    (entry) => entry.path === normalizedPath,
  );
  if (hasManifestPath) {
    return {
      valid: false,
      error: `docs/manifest.yml already contains a documents[] entry for "${normalizedPath}"`,
    };
  }

  const updatedManifest = buildManifestWithDocumentEntry(
    manifestState.content,
    manifestState.parsed,
    manifestState.documents,
    normalizedPath,
    document,
  );
  const documentPatch = createNewFilePatch(content, normalizedPath);
  const manifestPatch = createSimplePatch(
    manifestState.content,
    updatedManifest,
    MANIFEST_PATH,
  );
  const patch = `${documentPatch}\n${manifestPatch}`;

  const documentRisk = assessPatchRisk(
    project.policy,
    normalizedPath,
    '',
    content,
    documentPatch,
  );
  const manifestRisk = assessPatchRisk(
    project.policy,
    MANIFEST_PATH,
    manifestState.content,
    updatedManifest,
    manifestPatch,
  );
  const riskReasons = Array.from(
    new Set([...documentRisk.reasons, ...manifestRisk.reasons]),
  );
  const requiresApproval = documentRisk.highRisk || manifestRisk.highRisk;

  return {
    valid: true,
    path: normalizedPath,
    patch,
    manifestRevision: manifestState.revision,
    riskLevel: requiresApproval ? 'high' : 'low',
    requiresApproval,
    riskReasons,
    changedFiles: [normalizedPath, MANIFEST_PATH],
  };
}

function validateCreateDocumentPath(filePath: string): string | null {
  if (isPathTraversal(filePath)) {
    return `Path traversal detected: "${filePath}" is outside the project scope`;
  }

  if (!filePath.startsWith(ATLAS_DOCS_PREFIX)) {
    return `Path "${filePath}" must be under ${ATLAS_DOCS_PREFIX}`;
  }

  if (!filePath.toLowerCase().endsWith('.md')) {
    return `Path "${filePath}" must be a Markdown document under ${ATLAS_DOCS_PREFIX}`;
  }

  return null;
}

async function readManifestState(
  project: Project,
  branch: string,
): Promise<
  | ({ valid: true } & ManifestState)
  | { valid: false; error: string }
> {
  const { content, revision } = await project.readFile(branch, MANIFEST_PATH);

  if (content === null) {
    return {
      valid: false,
      error: `${MANIFEST_PATH} not found on branch "${branch}"`,
    };
  }

  if (!revision) {
    return {
      valid: false,
      error: `Could not determine the current revision for ${MANIFEST_PATH} on branch "${branch}"`,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = YAML.parse(content) as Record<string, unknown>;
  } catch (err) {
    return {
      valid: false,
      error: `Invalid YAML in ${MANIFEST_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: `${MANIFEST_PATH} must contain a top-level mapping`,
    };
  }

  if (!Array.isArray(parsed.documents)) {
    return {
      valid: false,
      error: `${MANIFEST_PATH} is missing a valid documents[] array`,
    };
  }

  const documents = parsed.documents.map((entry) =>
    ((entry && typeof entry === 'object' && !Array.isArray(entry))
      ? { ...(entry as Record<string, unknown>) }
      : {}) as Record<string, unknown>,
  );

  return {
    valid: true,
    content,
    revision,
    parsed,
    documents,
  };
}

function buildManifestWithDocumentEntry(
  originalContent: string,
  parsed: Record<string, unknown>,
  documents: Array<Record<string, unknown>>,
  filePath: string,
  document: DocumentCreateProposalMetadata,
): string {
  const updated = {
    ...parsed,
    documents: [
      ...documents,
      {
        path: filePath,
        role: document.role,
        ...(document.priority ? { priority: document.priority } : {}),
        summary: document.summary,
      },
    ],
  };

  const headerComment = extractLeadingYamlComment(originalContent);
  const serialized = YAML.stringify(updated).trimEnd() + '\n';
  return headerComment ? `${headerComment}${serialized}` : serialized;
}

function extractLeadingYamlComment(content: string): string {
  const match = content.match(/^((?:#.*\n)+)/);
  return match?.[1] ?? '';
}

function createNewFilePatch(content: string, filePath: string): string {
  return createUnifiedDiffForNewFile(filePath, content);
}

function createSimplePatch(
  original: string,
  updated: string,
  filePath: string,
): string {
  return createUnifiedDiffForReplacement(filePath, original, updated);
}

function normalizeManagedPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function getProposalValidationStatus(validation: {
  valid: boolean;
  failureType?: 'stale' | 'invalid';
}) {
  return validation.failureType === 'stale' ? 'stale' : 'rejected';
}

export async function handleProposePatch(
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
    const formatErrorFields = validation.formatError
      ? {
          errorCode: validation.formatError.code,
          expectedFormat: validation.formatError.expectedFormat,
          receivedFormat: validation.formatError.receivedFormat,
          hint: validation.formatError.hint,
        }
      : {};

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              error: validation.error,
              ...formatErrorFields,
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

export async function handlePreviewDiff(
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

  const validation = isDocumentCreateProposal(stored)
    ? await validateStoredDocumentCreateProposal(project, stored)
    : await validateStoredPatchProposal(project, stored);

  if (!validation.valid) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: false,
              applyable: validation.applyable ?? false,
              error: validation.error,
              proposalId: stored.id,
              status: stored.status,
              validationStatus: validation.failureType ?? 'invalid',
              projectId: project.projectId,
              path: stored.path,
              branch: stored.branch,
              changedFiles: getProposalChangedFiles(stored),
            },
            null,
            2,
          ),
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
            changedFiles: getProposalChangedFiles(stored),
            valid: true,
            applyable: validation.applyable ?? true,
            validationStatus: 'valid',
          },
          null,
          2,
        ),
      },
    ],
  };
}

export async function handleCommitPatch(
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

  const changedFiles = getProposalChangedFiles(stored);
  const validation = isDocumentCreateProposal(stored)
    ? await validateStoredDocumentCreateProposal(project, stored)
    : await validateStoredPatchProposal(project, stored);

  if (!validation.valid) {
    project.eventLog.updateProposalStatus(
      stored.id,
      getProposalValidationStatus(validation),
    );
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
              status: getProposalValidationStatus(validation),
              validationStatus: validation.failureType ?? 'invalid',
              message:
                validation.failureType === 'stale'
                  ? 'Proposal marked as stale. Re-read the file and create a new proposal.'
                  : 'Proposal marked as rejected because the stored patch is invalid. Re-create the proposal with a valid patch.',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

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

  const commitResult = isDocumentCreateProposal(stored)
    ? await project.gitStore.applyMultiFilePatchAndCommit(
        stored.branch,
        stored.patch,
        stored.summary,
        changedFiles,
        stored.metadata?.baseRevisions,
      )
    : await project.gitStore.applyPatchAndCommit(
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
            changedFiles,
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

async function validateStoredPatchProposal(
  project: Project,
  stored: StoredProposal,
): Promise<PatchValidation> {
  const patchProposal: PatchProposal = {
    projectId: stored.project_id,
    branch: stored.branch,
    path: stored.path,
    baseRevision: stored.base_revision,
    patch: stored.patch,
    intent: stored.intent,
    summary: stored.summary,
  };

  return validatePatch(
    project.policy,
    project.gitStore,
    patchProposal,
  );
}

async function validateStoredDocumentCreateProposal(
  project: Project,
  stored: StoredProposal,
): Promise<PatchValidation> {
  if (!stored.metadata) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: 'Stored proposal metadata is missing for docs.propose_document',
    };
  }

  const pathError = validateCreateDocumentPath(stored.path);
  if (pathError) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: pathError,
    };
  }

  const branchExists = await project.gitStore.branchExists(stored.branch);
  if (!branchExists) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Branch "${stored.branch}" does not exist. Create it with docs.create_branch first.`,
    };
  }

  if (await project.gitStore.fileExists(stored.branch, stored.path)) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `File "${stored.path}" already exists on branch "${stored.branch}"`,
    };
  }

  const expectedManifestRevision = stored.metadata.baseRevisions[MANIFEST_PATH];
  const currentManifestRevision = await project.gitStore.getFileRevision(
    stored.branch,
    MANIFEST_PATH,
  );

  if (!currentManifestRevision || currentManifestRevision !== expectedManifestRevision) {
    return {
      valid: false,
      failureType: 'stale',
      applyable: false,
      error: `Base revision mismatch for "${MANIFEST_PATH}" on branch "${stored.branch}": expected ${expectedManifestRevision}, but current revision is ${currentManifestRevision ?? 'missing'}. The file has been modified since you created the proposal. Re-read the manifest and create a new proposal.`,
    };
  }

  const manifestState = await readManifestState(project, stored.branch);
  if (!manifestState.valid) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: manifestState.error,
    };
  }

  if (manifestState.documents.some((entry) => entry.path === stored.path)) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `${MANIFEST_PATH} already contains a documents[] entry for "${stored.path}"`,
    };
  }

  const applyCheck = await project.gitStore.validatePatchApplyability(
    stored.branch,
    stored.patch,
    getProposalChangedFiles(stored),
  );
  if (!applyCheck.applyable) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Patch does not apply cleanly: ${applyCheck.error ?? 'Unknown git apply error'}`,
    };
  }

  return {
    valid: true,
    applyable: true,
    risk: {
      highRisk: stored.risk_level === 'high',
      reasons: stored.metadata.riskReasons ?? [],
    },
  };
}

function isDocumentCreateProposal(
  stored: StoredProposal,
): stored is StoredProposal & { metadata: ProposalMetadata } {
  return stored.metadata?.kind === 'document_create' && stored.metadata.mode === 'create';
}

function getProposalChangedFiles(stored: StoredProposal): string[] {
  if (stored.metadata?.changedFiles?.length) {
    return stored.metadata.changedFiles;
  }

  return [stored.path];
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
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }

  const targetDir = args.targetDir ?? project.root;
  let exportedFiles: string[];
  try {
    exportedFiles = await project.gitStore.exportBranch(
      args.branch,
      targetDir,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: message,
            projectId: project.projectId,
            branch: args.branch,
            targetDir,
          }),
        },
      ],
      isError: true,
    };
  }

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

// ── docs.status handler ────────────────────────────────────────────────

export async function handleStatus(project: Project, rawArgs: Record<string, unknown>) {
  const args = StatusSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }

  // Read STATUS.md
  const { content, revision } = await project.readFile(args.branch, 'STATUS.md');

  if (content === null) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'STATUS.md not found',
              projectId: project.projectId,
              branch: args.branch,
              path: 'STATUS.md',
              hint: 'Run xurgo-atlas init to create project front page (STATUS.md)',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Parse front matter
  const { frontMatter, rawFrontMatter, body } = parseFrontMatter(content);

  // Truncate body to maxChars
  let truncatedBody = body;
  let truncated = false;
  if (args.maxChars && body.length > args.maxChars) {
    truncatedBody = body.slice(0, args.maxChars);
    truncated = true;
  }

  // Build summary from front matter
  const summary: Record<string, unknown> = {};
  if (frontMatter) {
    if (frontMatter.currentFocus) summary.currentFocus = frontMatter.currentFocus;
    if (frontMatter.nextActions) summary.nextActions = frontMatter.nextActions;
    if (frontMatter.blockers) summary.blockers = frontMatter.blockers;
    if (frontMatter.doNotDo) summary.doNotDo = frontMatter.doNotDo;
    if (frontMatter.relatedDocs) summary.relatedDocs = frontMatter.relatedDocs;
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            path: 'STATUS.md',
            branch: args.branch,
            revision,
            frontMatter: frontMatter ?? null,
            rawFrontMatter: rawFrontMatter ?? null,
            summary,
            body: truncatedBody,
            truncated,
            maxChars: args.maxChars,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ── docs.manifest handler ──────────────────────────────────────────────

export async function handleManifest(project: Project, rawArgs: Record<string, unknown>) {
  const args = ManifestSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }
  const manifestPath = 'docs/manifest.yml';

  // Read docs/manifest.yml from the managed store
  const { content, revision } = await project.readFile(args.branch, manifestPath);

  if (content === null) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'docs/manifest.yml not found',
              projectId: project.projectId,
              branch: args.branch,
              path: manifestPath,
              hint: 'Run xurgo-atlas init to create project documentation structure (docs/manifest.yml)',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Parse YAML
  let parsed: Record<string, unknown>;
  try {
    parsed = YAML.parse(content) as Record<string, unknown>;
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'Invalid YAML in docs/manifest.yml',
              projectId: project.projectId,
              branch: args.branch,
              path: manifestPath,
              details: err instanceof Error ? err.message : String(err),
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Extract documents and entrypoints (gracefully handle missing/malformed data)
  const documents: unknown[] = Array.isArray(parsed?.documents) ? parsed.documents as unknown[] : [];
  const entrypoints: unknown[] = Array.isArray(parsed?.entrypoints) ? parsed.entrypoints as unknown[] : [];

  // Apply maxDocuments truncation
  let truncated = false;
  let processedDocuments = documents;
  if (args.maxDocuments && documents.length > args.maxDocuments) {
    processedDocuments = documents.slice(0, args.maxDocuments);
    truncated = true;
  }

  // Collect all paths for validation (from both entrypoints and documents)
  const allReferencedPaths: string[] = [];
  for (const ep of entrypoints) {
    const p = (ep as Record<string, unknown>)?.path;
    if (typeof p === 'string' && p) allReferencedPaths.push(p);
  }
  for (const doc of processedDocuments) {
    const p = (doc as Record<string, unknown>)?.path;
    if (typeof p === 'string' && p) allReferencedPaths.push(p);
  }

  // Path validation (lightweight: use git ls-tree to list all tracked files)
  let missingPaths: string[] = [];
  let valid = true;
  const warnings: string[] = [];
  if (args.validatePaths) {
    const trackedFiles = await project.gitStore.listFiles(args.branch);
    const trackedSet = new Set(trackedFiles);
    missingPaths = allReferencedPaths.filter((p) => !trackedSet.has(p));
    valid = missingPaths.length === 0;
  }

  // Build the response
  const response: Record<string, unknown> = {
    projectId: project.projectId,
    path: manifestPath,
    branch: args.branch,
    revision,
    version: parsed?.version ?? null,
    entrypoints,
    documents: processedDocuments,
    documentCount: processedDocuments.length,
    totalDocumentCount: documents.length,
    truncated,
  };

  // Optionally include raw YAML
  if (args.includeRaw) {
    response.raw = content;
  }

  // Optionally include path validation result
  if (args.validatePaths) {
    response.validation = {
      valid,
      missingPaths,
    };
    if (warnings.length > 0) {
      (response.validation as Record<string, unknown>).warnings = warnings;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

// ── docs.context_pack handler ─────────────────────────────────────────

type ContextPackItemKind = 'status' | 'agents' | 'manifest' | 'section' | 'document';

interface ContextPackItem {
  kind: ContextPackItemKind;
  path: string;
  heading?: string;
  matchedHeading?: string;
  level?: number;
  occurrence?: number;
  startLine?: number;
  endLine?: number;
  content: string;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
  revision: string | null;
  missing?: boolean;
  error?: string;
  manifest?: Record<string, unknown>;
}

interface ContextReadResult {
  content: string | null;
  revision: string | null;
}

export async function handleContextPack(project: Project, rawArgs: Record<string, unknown>) {
  const args = ContextPackSchema.parse(rawArgs);
  const missingBranch = await managedBranchMissingError(project, args.branch);
  if (missingBranch) {
    return missingBranch;
  }

  const validationError = await validateContextPackPaths(
    project,
    args.branch,
    args.paths,
    args.sections,
  );
  if (validationError) {
    return validationError;
  }

  const items: ContextPackItem[] = [];
  const seenDocuments = new Set<string>();
  const packRevision = args.revision ?? await project.gitStore.getBranchHead(args.branch);
  let returnedChars = 0;
  let truncated = false;
  let manifestData: Record<string, unknown> | null = null;

  const addItem = (item: Omit<ContextPackItem, 'content' | 'returnedChars' | 'truncated'> & { content?: string; maxChars?: number }): void => {
    const content = item.content ?? '';
    const bounded = sliceForContextPack(content, args.maxChars, returnedChars, item.maxChars);
    const { maxChars: _itemMaxChars, ...packItem } = item;
    returnedChars += bounded.returnedChars;
    truncated = truncated || bounded.truncated;

    items.push({
      ...packItem,
      content: bounded.content,
      returnedChars: bounded.returnedChars,
      truncated: bounded.truncated,
    });
  };

  if (args.includeStatus) {
    const status = await readContextFile(project, args.branch, args.revision, 'STATUS.md');
    if (status.content === null) {
      addItem(missingContextItem('status', 'STATUS.md', status.revision, 'STATUS.md not found'));
    } else {
      addItem({
        kind: 'status',
        path: 'STATUS.md',
        revision: status.revision,
        content: status.content,
        totalChars: status.content.length,
      });
    }
  }

  if (args.includeAgents) {
    const agents = await readContextFile(project, args.branch, args.revision, 'AGENTS.md');
    if (agents.content === null) {
      addItem(missingContextItem('agents', 'AGENTS.md', agents.revision, 'AGENTS.md not found'));
    } else {
      addItem({
        kind: 'agents',
        path: 'AGENTS.md',
        revision: agents.revision,
        content: agents.content,
        totalChars: agents.content.length,
      });
    }
  }

  if (args.includeManifest) {
    const manifest = await readContextFile(project, args.branch, args.revision, 'docs/manifest.yml');
    if (manifest.content === null) {
      addItem(missingContextItem('manifest', 'docs/manifest.yml', manifest.revision, 'docs/manifest.yml not found'));
    } else {
      try {
        manifestData = parseManifestForContextPack(manifest.content, args.maxDocuments);
        addItem({
          kind: 'manifest',
          path: 'docs/manifest.yml',
          revision: manifest.revision,
          content: manifest.content,
          totalChars: manifest.content.length,
          manifest: manifestData,
        });
      } catch (err) {
        addItem({
          kind: 'manifest',
          path: 'docs/manifest.yml',
          revision: manifest.revision,
          content: manifest.content,
          totalChars: manifest.content.length,
          missing: true,
          error: `Invalid YAML in docs/manifest.yml: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } else {
    const manifest = await readContextFile(project, args.branch, args.revision, 'docs/manifest.yml');
    if (manifest.content !== null) {
      try {
        manifestData = parseManifestForContextPack(manifest.content, args.maxDocuments);
      } catch {
        manifestData = null;
      }
    }
  }

  for (const sectionRequest of args.sections) {
    const sectionFile = await readContextFile(project, args.branch, args.revision, sectionRequest.path);
    if (sectionFile.content === null) {
      addItem(missingContextItem('section', sectionRequest.path, sectionFile.revision, `File "${sectionRequest.path}" not found`, sectionRequest.heading));
      continue;
    }

    const section = findMarkdownSection(sectionFile.content, {
      heading: sectionRequest.heading,
      level: sectionRequest.level,
      occurrence: sectionRequest.occurrence,
      includeHeading: sectionRequest.includeHeading,
    });

    if (!section) {
      addItem(missingContextItem('section', sectionRequest.path, sectionFile.revision, `Heading "${sectionRequest.heading}" not found in "${sectionRequest.path}"`, sectionRequest.heading));
      continue;
    }

    addItem({
      kind: 'section',
      path: sectionRequest.path,
      heading: sectionRequest.heading,
      matchedHeading: section.matchedHeading,
      level: section.level,
      occurrence: sectionRequest.occurrence,
      startLine: section.startLine,
      endLine: section.endLine,
      revision: sectionFile.revision,
      content: applyOffset(section.content, sectionRequest.offset),
      totalChars: section.content.length,
      maxChars: sectionRequest.maxChars,
    });
  }

  const hasExplicitContent = args.paths.length > 0 || args.sections.length > 0;
  const documentPaths = args.paths.length > 0
    ? args.paths
    : hasExplicitContent
      ? []
      : getManifestGuidedContextPaths(manifestData);
  const boundedDocumentPaths = args.maxDocuments
    ? documentPaths.slice(0, args.maxDocuments)
    : documentPaths;
  if (documentPaths.length > boundedDocumentPaths.length) {
    truncated = true;
  }

  for (const documentPath of boundedDocumentPaths) {
    if (seenDocuments.has(documentPath)) {
      continue;
    }
    seenDocuments.add(documentPath);

    const document = await readContextFile(project, args.branch, args.revision, documentPath);
    if (document.content === null) {
      addItem(missingContextItem('document', documentPath, document.revision, `File "${documentPath}" not found`));
      continue;
    }

    addItem({
      kind: 'document',
      path: documentPath,
      revision: document.revision,
      content: document.content,
      totalChars: document.content.length,
    });
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            projectId: project.projectId,
            branch: args.branch,
            revision: packRevision,
            maxChars: args.maxChars ?? null,
            returnedChars,
            truncated,
            items,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function validateContextPackPaths(
  project: Project,
  branch: string,
  paths: string[],
  sections: Array<z.infer<typeof ContextPackSectionSchema>>,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
} | null> {
  const explicitPaths = [
    ...paths,
    ...sections.map((section) => section.path),
  ];

  return validateContextPackPathsAsync(project, branch, explicitPaths);
}

async function validateContextPackPathsAsync(
  project: Project,
  branch: string,
  explicitPaths: string[],
) {
  for (const filePath of explicitPaths) {
    if (isPathTraversal(filePath)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: `Path traversal detected: "${filePath}" is outside the project scope`,
              path: filePath,
            }),
          },
        ],
        isError: true,
      };
    }

    if (!(await project.isPathOwned(branch, filePath))) {
      return ownedPathError(project.projectId, filePath, branch);
    }
  }

  return null;
}

function ownedPathError(projectId: string, filePath: string, branch: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: `Path "${filePath}" is not in the list of Atlas-owned managed documents`,
          projectId,
          path: filePath,
          branch,
        }),
      },
    ],
    isError: true,
  };
}

async function managedBranchMissingError(project: Project, branch: string) {
  const branchExists = await project.gitStore.branchExists(branch);
  if (branchExists) {
    return null;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: `Managed docs branch "${branch}" does not exist`,
          projectId: project.projectId,
          branch,
          hint: `Managed docs branches are separate from the source repo branch. Create "${branch}" with docs.create_branch or use an existing managed branch.`,
        }),
      },
    ],
    isError: true,
  };
}

async function readContextFile(
  project: Project,
  branch: string,
  revision: string | undefined,
  filePath: string,
): Promise<ContextReadResult> {
  if (revision) {
    return {
      content: await project.gitStore.readFileAtRevision(revision, filePath),
      revision,
    };
  }

  return project.readFile(branch, filePath);
}

function sliceForContextPack(
  content: string,
  maxChars: number | undefined,
  usedChars: number,
  itemMaxChars?: number,
): { content: string; returnedChars: number; truncated: boolean } {
  const packRemaining = maxChars === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, maxChars - usedChars);
  const itemLimit = itemMaxChars ?? Number.POSITIVE_INFINITY;
  const limit = Math.min(packRemaining, itemLimit);

  if (content.length > limit) {
    const sliced = content.slice(0, limit);
    return {
      content: sliced,
      returnedChars: sliced.length,
      truncated: true,
    };
  }

  return {
    content,
    returnedChars: content.length,
    truncated: false,
  };
}

function applyOffset(content: string, offset: number): string {
  if (offset <= 0) {
    return content;
  }
  return content.slice(offset);
}

function missingContextItem(
  kind: ContextPackItemKind,
  path: string,
  revision: string | null,
  error: string,
  heading?: string,
): Omit<ContextPackItem, 'content' | 'returnedChars' | 'truncated'> & { content?: string } {
  return {
    kind,
    path,
    heading,
    revision,
    content: '',
    totalChars: 0,
    missing: true,
    error,
  };
}

function parseManifestForContextPack(content: string, maxDocuments?: number): Record<string, unknown> {
  const parsed = YAML.parse(content) as Record<string, unknown>;
  const documents = Array.isArray(parsed?.documents)
    ? parsed.documents as unknown[]
    : [];
  const processedDocuments = maxDocuments
    ? documents.slice(0, maxDocuments)
    : documents;

  return {
    version: parsed?.version ?? null,
    entrypoints: Array.isArray(parsed?.entrypoints) ? parsed.entrypoints : [],
    documents: processedDocuments,
    documentCount: processedDocuments.length,
    totalDocumentCount: documents.length,
    truncated: processedDocuments.length < documents.length,
  };
}

function getManifestGuidedContextPaths(manifestData: Record<string, unknown> | null): string[] {
  if (!manifestData || !Array.isArray(manifestData.documents)) {
    return [];
  }

  const skip = new Set(['STATUS.md', 'AGENTS.md', 'docs/manifest.yml']);
  const paths: string[] = [];
  for (const document of manifestData.documents) {
    const filePath = (document as Record<string, unknown>)?.path;
    if (typeof filePath !== 'string' || skip.has(filePath)) {
      continue;
    }
    paths.push(filePath);
  }

  return paths;
}

// ── Front matter parser ────────────────────────────────────────────────

/**
 * Parse YAML front matter from a Markdown file.
 *
 * Expects content in the format:
 *   ---
 *   key: value
 *   ---
 *   body text
 *
 * Returns the parsed front matter object, raw YAML text, and body.
 * If no valid front matter is found, returns null values and the full content as body.
 */
export function parseFrontMatter(content: string): {
  frontMatter: Record<string, unknown> | null;
  rawFrontMatter: string | null;
  body: string;
} {
  const lines = content.split('\n');
  if (lines.length < 3 || lines[0].trim() !== '---') {
    return { frontMatter: null, rawFrontMatter: null, body: content };
  }

  // Find closing ---
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontMatter: null, rawFrontMatter: null, body: content };
  }

  const rawYaml = lines.slice(1, endIdx).join('\n');
  const body = lines.slice(endIdx + 1).join('\n');

  try {
    const parsed = YAML.parse(rawYaml);
    return {
      frontMatter: (parsed as Record<string, unknown>) ?? null,
      rawFrontMatter: rawYaml,
      body,
    };
  } catch {
    return { frontMatter: null, rawFrontMatter: rawYaml, body };
  }
}
