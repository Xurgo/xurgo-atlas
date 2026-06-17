import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';

export interface GitIdentity {
  insideWorkTree: boolean;
  worktreeRoot: string | null;
  commonDir: string | null;
  branch: string | null;
  head: string | null;
}

export async function inspectGitIdentity(cwd: string): Promise<GitIdentity> {
  const resolvedCwd = normalizeExistingPath(cwd) ?? path.resolve(cwd);
  const git = simpleGit({ baseDir: resolvedCwd });

  try {
    const insideWorkTree = (await git.raw(['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
    if (!insideWorkTree) {
      return emptyGitIdentity();
    }

    const worktreeRoot = (await git.raw(['rev-parse', '--show-toplevel'])).trim();
    const commonDirRaw = (await git.raw(['rev-parse', '--git-common-dir'])).trim();
    const branchInfo = await git.branch();
    const head = (await git.raw(['rev-parse', 'HEAD'])).trim();

    return {
      insideWorkTree: true,
      worktreeRoot: normalizeExistingPath(worktreeRoot),
      commonDir: normalizeGitPath(commonDirRaw, resolvedCwd),
      branch: normalizeGitBranch(branchInfo.current),
      head: head.length > 0 ? head : null,
    };
  } catch {
    return emptyGitIdentity();
  }
}

function normalizeGitPath(gitPath: string, cwd: string): string | null {
  if (gitPath.length === 0) {
    return null;
  }

  return normalizeExistingPath(path.isAbsolute(gitPath) ? gitPath : path.resolve(cwd, gitPath));
}

export function normalizeExistingPath(input: string): string | null {
  const resolved = path.resolve(input);

  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizeGitBranch(branch: string): string | null {
  const trimmed = branch.trim();
  if (trimmed.length === 0 || trimmed === 'HEAD') {
    return null;
  }
  return trimmed;
}

function emptyGitIdentity(): GitIdentity {
  return {
    insideWorkTree: false,
    worktreeRoot: null,
    commonDir: null,
    branch: null,
    head: null,
  };
}
