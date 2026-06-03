import { Policy } from './policy.js';
import { GitStore } from './git-store.js';
import { isPathOwned } from './ownership.js';
import { assessPatchRisk, RiskAssessment } from './risk.js';

export interface PatchProposal {
  projectId: string;
  branch: string;
  path: string;
  baseRevision: string;
  patch: string;
  intent: string;
  summary: string;
}

export interface PatchValidation {
  valid: boolean;
  failureType?: 'stale' | 'invalid';
  applyable?: boolean;
  error?: string;
  risk?: RiskAssessment;
  formatError?: PatchFormatError;
}

export interface PatchFormatError {
  code: 'invalid_patch_format';
  expectedFormat: 'unified_diff';
  receivedFormat: 'apply_patch' | 'empty' | 'prose' | 'unknown';
  hint: string;
}

/**
 * Validate a patch proposal against the policy and current state.
 */
export async function validatePatch(
  policy: Policy,
  gitStore: GitStore,
  proposal: PatchProposal,
): Promise<PatchValidation> {
  const { branch, path, baseRevision, patch, intent, summary } = proposal;

  // Validate required metadata
  const requiredMetadata = policy.getRequiredMetadata();
  const missingMetadata = requiredMetadata.filter((field) => {
    const value = (proposal as unknown as Record<string, unknown>)[field];
    return value === undefined || value === null || value === '';
  });
  if (missingMetadata.length > 0) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Missing required metadata: ${missingMetadata.join(', ')}`,
    };
  }

  const formatError = getPatchFormatError(patch);
  if (formatError) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: buildUnifiedDiffRequirementMessage(formatError),
      formatError,
    };
  }

  // Validate path is inside the project (no path traversal)
  if (isPathTraversal(path)) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Path traversal detected: "${path}" is outside the project scope`,
    };
  }

  // Validate the branch exists
  const branchExists = await gitStore.branchExists(branch);
  if (!branchExists) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Branch "${branch}" does not exist. Create it with docs.create_branch first.`,
    };
  }

  // Validate the path is an Atlas-owned managed document on this branch.
  if (!(await isPathOwned(gitStore, branch, path))) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Path "${path}" is not in the list of Atlas-owned managed documents`,
    };
  }

  // Validate baseRevision matches current file revision on the selected branch
  const currentRevision = await gitStore.getFileRevision(branch, path);
  if (!currentRevision) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `File "${path}" not found on branch "${branch}"`,
    };
  }

  if (currentRevision && currentRevision !== baseRevision) {
    return {
      valid: false,
      failureType: 'stale',
      applyable: false,
      error: `Base revision mismatch for "${path}" on branch "${branch}": expected ${baseRevision}, but current revision is ${currentRevision}. The file has been modified since you read it. Re-read the file and re-create your patch.`,
    };
  }

  // Read the current file content for patch testing
  const originalContent = (await gitStore.readFile(branch, path)) ?? '';

  const applyCheck = await gitStore.validatePatchApplyability(branch, patch, [path]);
  if (!applyCheck.applyable) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Patch does not apply cleanly: ${applyCheck.error ?? 'Unknown git apply error'}`,
    };
  }

  // Attempt to apply the patch to validate it applies cleanly
  let newContent: string;
  try {
    newContent = applyUnifiedDiff(originalContent, patch);
  } catch (err: unknown) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: false,
      error: `Patch does not apply cleanly: ${(err as Error).message}`,
    };
  }

  // Check for forbidden operations
  if (policy.isOperationForbidden('silent_delete') && newContent.trim().length === 0 && originalContent.trim().length > 0) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: true,
      error: 'Patch results in an empty file. Silent deletion is forbidden without approval.',
    };
  }

  if (policy.isOperationForbidden('delete_protected_doc_without_approval') && newContent.trim().length === 0 && policy.isPathProtected(path)) {
    return {
      valid: false,
      failureType: 'invalid',
      applyable: true,
      error: 'Deleting a protected document requires special approval.',
    };
  }

  // AGENTS.md intent validation: require explicit reference to safety/agent rules
  if (path === 'AGENTS.md') {
    const agentsMdKeywords = [
      'AGENTS.md',
      'agent instructions',
      'documentation safety',
      'docs safety',
      'MCP docs workflow',
      'project agent rules',
      'safety rules',
    ];
    const combinedText = `${intent} ${summary}`.toLowerCase();
    const hasValidReference = agentsMdKeywords.some((kw) =>
      combinedText.includes(kw.toLowerCase()),
    );
    if (!hasValidReference) {
      return {
        valid: false,
        failureType: 'invalid',
        applyable: true,
        error:
          'Changes to AGENTS.md require an intent or summary that explicitly references one of: ' +
          'AGENTS.md, agent instructions, documentation safety, docs safety, ' +
          'MCP docs workflow, project agent rules, safety rules. ' +
          `Current intent: "${intent}", summary: "${summary}"`,
      };
    }
  }

  // Assess risk
  const risk = assessPatchRisk(policy, path, originalContent, newContent, patch);

  return {
    valid: true,
    applyable: true,
    risk,
  };
}

export function getPatchFormatError(patch: string): PatchFormatError | null {
  const trimmedPatch = patch.trim();

  if (trimmedPatch.length === 0) {
    return {
      code: 'invalid_patch_format',
      expectedFormat: 'unified_diff',
      receivedFormat: 'empty',
      hint: 'Provide a standard unified diff with ---/+++ file headers and at least one @@ hunk.',
    };
  }

  if (
    /^\*\*\* Begin Patch$/m.test(patch) ||
    /^\*\*\* Update File:/m.test(patch)
  ) {
    return {
      code: 'invalid_patch_format',
      expectedFormat: 'unified_diff',
      receivedFormat: 'apply_patch',
      hint: 'docs.propose_patch accepts standard unified diffs only. Do not send apply_patch blocks such as *** Begin Patch or *** Update File:.',
    };
  }

  const hasOldFileHeader = /^--- .+/m.test(patch);
  const hasNewFileHeader = /^\+\+\+ .+/m.test(patch);
  const hasHunkHeader = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(patch);

  if (hasOldFileHeader && hasNewFileHeader && hasHunkHeader) {
    return null;
  }

  const receivedFormat = /^[A-Za-z0-9"'`]/.test(trimmedPatch)
    ? 'prose'
    : 'unknown';

  return {
    code: 'invalid_patch_format',
    expectedFormat: 'unified_diff',
    receivedFormat,
    hint: 'Use unified diff syntax with ---/+++ file headers and @@ hunks that describe line-level additions and removals.',
  };
}

export function buildUnifiedDiffRequirementMessage(
  formatError: PatchFormatError,
): string {
  const reasons: Record<PatchFormatError['receivedFormat'], string> = {
    apply_patch:
      'Received apply_patch-style input instead of a unified diff.',
    empty: 'Received an empty or whitespace-only patch body.',
    prose: 'Received prose or non-diff text instead of patch content.',
    unknown: 'Received patch content that does not match unified diff syntax.',
  };

  return `docs.propose_patch requires a standard unified diff patch. ${reasons[formatError.receivedFormat]} ${formatError.hint}`;
}

/**
 * Apply a unified diff to a source string and return the result.
 * This is a minimal unified diff applicator for simple patches.
 */
export function applyUnifiedDiff(source: string, patch: string): string {
  const sourceLines = source.split('\n');
  // Keep trailing newline semantics
  const sourceHasTrailingNewline = source.endsWith('\n');

  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) {
    // If no hunks found, check if this is a full replacement patch
    // (e.g., only ---/+++ lines)
    if (patch.trim().length > 0) {
      // Maybe the patch is the full content?
      return patch;
    }
    return source;
  }

  let result = applyHunks(sourceLines, hunks);

  // Preserve trailing newline behavior
  if (sourceHasTrailingNewline && !result.endsWith('\n')) {
    result = result + '\n';
  }

  return result;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function parseUnifiedDiff(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = patch.split('\n');

  let i = 0;
  // Skip header lines (---/+++)
  while (i < lines.length) {
    if (lines[i].startsWith('@@')) {
      break;
    }
    i++;
  }

  // Parse hunks
  let currentHunk: Hunk | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const hunkHeader = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkHeader) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldLines: hunkHeader[2] ? parseInt(hunkHeader[2], 10) : 1,
        newStart: parseInt(hunkHeader[3], 10),
        newLines: hunkHeader[4] ? parseInt(hunkHeader[4], 10) : 1,
        lines: [],
      };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

function applyHunks(sourceLines: string[], hunks: Hunk[]): string {
  // Work from bottom to top to preserve line numbers
  const sortedHunks = [...hunks].sort(
    (a, b) => b.oldStart - a.oldStart,
  );

  let result = [...sourceLines];

  for (const hunk of sortedHunks) {
    const startIdx = hunk.oldStart - 1; // Convert to 0-indexed
    const contextLineCount = countContextLines(hunk.lines);

    // Remove the old lines that are being replaced
    const deleteCount = hunk.oldLines;

    // Build new lines from the hunk (skip context and deletion lines, keep addition lines)
    const newLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        newLines.push(line.slice(1));
      } else if (line.startsWith(' ')) {
        // Context line - keep
        newLines.push(line.slice(1));
      }
      // '-' lines are deleted, skip them
    }

    // Apply the hunk
    result.splice(startIdx, deleteCount, ...newLines);
  }

  return result.join('\n');
}

function countContextLines(lines: string[]): number {
  return lines.filter((l) => l.startsWith(' ')).length;
}

/**
 * Check if a path attempts traversal outside the project root.
 */
export function isPathTraversal(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Check for absolute paths
  if (normalized.startsWith('/')) {
    return true;
  }
  // Check for parent directory traversal
  const parts = normalized.split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') {
      depth--;
      // Any attempt to go above root is traversal
      if (depth < 0) return true;
    } else if (part !== '.' && part !== '') {
      depth++;
    }
  }
  // Also detect if the final path resolves differently or if '..' was used at all
  // to escape a subdirectory (e.g., docs/../policy.yml escapes docs/)
  if (normalized.includes('..')) {
    return true;
  }
  // Check for empty segments that could be used for traversal
  if (normalized.includes('//') || normalized.includes('/./')) {
    return true;
  }
  return false;
}
