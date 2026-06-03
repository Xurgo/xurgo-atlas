import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';

export interface FileEntry {
  path: string;
  content: string;
}

export interface CommitResult {
  hash: string;
  branch: string;
  message: string;
}

export interface HistoryEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface PatchApplyCheckResult {
  applyable: boolean;
  error?: string;
}

export class GitStore {
  private repoPath: string;
  private workDir: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.workDir = path.join(repoPath, 'workdir');
  }

  get repoDir(): string {
    return this.repoPath;
  }

  /**
   * Initialize a new bare Git repository for the docs store.
   */
  async init(): Promise<void> {
    await fs.promises.mkdir(this.repoPath, { recursive: true });
    const git = simpleGit({ baseDir: this.repoPath });
    await git.init(true);
  }

  /**
   * Check if the store has been initialized.
   */
  async isInitialized(): Promise<boolean> {
    try {
      const gitDir = path.join(this.repoPath, 'HEAD');
      await fs.promises.access(gitDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a simple-git instance for the working directory.
   * Clones the bare repo to workDir if not already cloned.
   */
  private async getGit(branch?: string): Promise<SimpleGit> {
    const gitDirExists = await this.dirExists(this.workDir);
    if (!gitDirExists) {
      await fs.promises.mkdir(this.workDir, { recursive: true });
      const git = simpleGit({ baseDir: this.workDir });
      await git.clone(this.repoPath, this.workDir, ['--no-checkout', '--shared']);
    }

    const git = simpleGit({ baseDir: this.workDir });
    if (branch) {
      try {
        await git.checkout(branch);
      } catch {
        // Branch may not exist locally; fetch from origin
        try {
          await git.fetch('origin', branch);
          await git.checkout(branch);
        } catch {
          // Branch doesn't exist yet
        }
      }
    }
    return git;
  }

  /**
   * Clone the bare repo to workDir, checkout branch, perform work, and push back.
   */
  private async withWorkDir<T>(
    branch: string,
    fn: (git: SimpleGit, workDir: string) => Promise<T>,
  ): Promise<T> {
    // Clone or fetch the bare repo
    if (!(await this.dirExists(this.workDir))) {
      await fs.promises.mkdir(this.workDir, { recursive: true });
      const git = simpleGit({ baseDir: this.workDir });
      await git.clone(this.repoPath, this.workDir, ['--shared']);
    }

    const git = simpleGit({ baseDir: this.workDir });

    // Fetch all branches
    try {
      await git.fetch('origin', '--all');
    } catch {
      // First fetch may fail if repo is empty
    }

    // Check if branch exists remotely
    let branchExists = false;
    try {
      const branches = await git.branch(['-a']);
      branchExists = branches.all.some(
        (b: string) => b === branch || b === `origin/${branch}` || b === `remotes/origin/${branch}`,
      );
    } catch {
      // No branches yet
    }

    if (branchExists) {
      // Checkout the branch (tracking origin)
      try {
        await git.checkout(branch);
      } catch {
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
    } else {
      // Create a new orphan branch or checkout default
      try {
        await git.checkout('main');
      } catch {
        // No commits yet, create an initial commit
        await git.raw(['checkout', '--orphan', 'main']);
        try {
          await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);
        } catch {
          // Already has commits
        }
      }
    }

    // Ensure clean working directory before each operation.
    // This prevents stale files from a previous failed or interrupted
    // operation from leaking into the current one.
    try {
      await git.raw(['reset', '--hard', 'HEAD']);
      await git.raw(['clean', '-fd']);
    } catch {
      // No commits yet — nothing to reset or clean
    }

    const result = await fn(git, this.workDir);

    // Push changes back to bare repo
    try {
      const currentBranch = (await git.branch()).current;
      await git.push('origin', currentBranch);
    } catch {
      // Push may fail if no changes
    }

    return result;
  }

  /**
   * Snapshot a set of files into the store.
   * Creates an initial commit on 'main' branch.
   */
  async snapshotInitial(files: FileEntry[]): Promise<CommitResult> {
    return this.withWorkDir('main', async (git: SimpleGit, workDir: string) => {
      // Write all files to workdir
      for (const file of files) {
        const fullPath = path.join(workDir, file.path);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, file.content, 'utf-8');
      }

      // Check if there are any existing commits
      let hasCommits = false;
      try {
        const log = await git.log({ maxCount: 1 });
        hasCommits = log.total > 0;
      } catch {
        hasCommits = false;
      }

      if (!hasCommits) {
        // Initial commit on main
        await git.add('.');
        const result = await git.commit('Initial documentation snapshot');
        return {
          hash: result.commit,
          branch: 'main',
          message: 'Initial documentation snapshot',
        };
      }

      // Check for changes
      const status = await git.status();
      if (status.files.length > 0) {
        await git.add('.');
        const result = await git.commit('Update documentation snapshot');
        return {
          hash: result.commit,
          branch: 'main',
          message: 'Update documentation snapshot',
        };
      }

      // No changes, return current HEAD
      const log = await git.log({ maxCount: 1 });
      return {
        hash: log.latest?.hash ?? 'unknown',
        branch: 'main',
        message: 'No changes',
      };
    });
  }

  /**
   * Read a file from a branch at its HEAD revision.
   */
  async readFile(branch: string, filePath: string): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });

    try {
      const content = await bareGit.show([`${branch}:${filePath}`]);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Read a file at a specific revision.
   */
  async readFileAtRevision(revision: string, filePath: string): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });

    try {
      const content = await bareGit.show([`${revision}:${filePath}`]);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Create a new branch from an existing branch.
   */
  async createBranch(branch: string, sourceBranch = 'main'): Promise<void> {
    return this.withWorkDir(sourceBranch, async (git: SimpleGit, _workDir: string) => {
      await git.checkoutLocalBranch(branch);
      await git.push('origin', branch);
    });
  }

  /**
   * Check if a branch exists.
   */
  async branchExists(branch: string): Promise<boolean> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const result = await bareGit.branch(['-a']);
      return result.all.some(
        (b: string) =>
          b === branch ||
          b === `origin/${branch}` ||
          b === `remotes/origin/${branch}`,
      );
    } catch {
      return false;
    }
  }

  /**
   * Get the HEAD revision for a file on a branch.
   */
  async getFileRevision(branch: string, filePath: string): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const result = await bareGit.log([
        branch,
        '--',
        filePath,
        '-n',
        '1',
        '--pretty=format:%H',
      ]);
      if (result.latest) {
        return result.latest.hash;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the HEAD revision for a branch.
   */
  async getBranchHead(branch: string): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const result = await bareGit.revparse([branch]);
      return result.trim();
    } catch {
      return null;
    }
  }

  /**
   * Apply content changes to a file and commit on the branch.
   */
  async applyAndCommit(
    branch: string,
    filePath: string,
    content: string,
    message: string,
    baseRevision?: string,
  ): Promise<CommitResult> {
    return this.withWorkDir(branch, async (git: SimpleGit, workDir: string) => {
      // Verify base revision if provided
      if (baseRevision) {
        const currentRevision = await this.getFileRevision(branch, filePath);
        if (currentRevision && currentRevision !== baseRevision) {
          throw new Error(
            `Base revision mismatch: expected ${baseRevision}, but current revision is ${currentRevision}. The file has been modified since you read it.`,
          );
        }
      }

      // Write the new content
      const fullPath = path.join(workDir, filePath);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content, 'utf-8');

      await git.add(filePath);
      const result = await git.commit(message);
      await git.push('origin', branch);

      return {
        hash: result.commit,
        branch,
        message,
      };
    });
  }

  /**
   * Apply a unified diff patch to a file on a branch and commit.
   */
  async applyPatchAndCommit(
    branch: string,
    filePath: string,
    patchContent: string,
    message: string,
    baseRevision?: string,
  ): Promise<CommitResult> {
    return this.applyMultiFilePatchAndCommit(
      branch,
      patchContent,
      message,
      [filePath],
      baseRevision ? { [filePath]: baseRevision } : undefined,
    );
  }

  /**
   * Validate whether a unified diff can be applied cleanly on a branch without committing.
   */
  async validatePatchApplyability(
    branch: string,
    patchContent: string,
    changedFiles: string[],
  ): Promise<PatchApplyCheckResult> {
    return this.withWorkDir(branch, async (git: SimpleGit, workDir: string) => {
      if (changedFiles.length === 0) {
        return {
          applyable: false,
          error: 'Patch does not name any changed files',
        };
      }

      for (const filePath of changedFiles) {
        const fullPath = path.join(workDir, filePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      }

      const patchFile = path.join(workDir, '.docu-guard-patch-check.tmp');
      await fs.promises.writeFile(patchFile, patchContent, 'utf-8');

      try {
        const applyResult = await git.raw([
          'apply',
          '--check',
          '--unidiff-zero',
          '--whitespace=nowarn',
          patchFile,
        ]);

        if (applyResult && applyResult.includes('error:')) {
          return {
            applyable: false,
            error: applyResult.trim(),
          };
        }

        return { applyable: true };
      } catch (err: unknown) {
        return {
          applyable: false,
          error: (err as Error).message,
        };
      } finally {
        try {
          await fs.promises.unlink(patchFile);
        } catch { /* ignore */ }
      }
    });
  }

  /**
   * Apply a unified diff patch that can touch multiple files and commit atomically.
   */
  async applyMultiFilePatchAndCommit(
    branch: string,
    patchContent: string,
    message: string,
    changedFiles: string[],
    baseRevisions?: Record<string, string>,
  ): Promise<CommitResult> {
    return this.withWorkDir(branch, async (git: SimpleGit, workDir: string) => {
      if (changedFiles.length === 0) {
        throw new Error('Patch does not name any changed files');
      }

      if (baseRevisions) {
        for (const [filePath, expectedRevision] of Object.entries(baseRevisions)) {
          const currentRevision = await this.getFileRevision(branch, filePath);
          if (currentRevision && currentRevision !== expectedRevision) {
            throw new Error(
              `Base revision mismatch: expected ${expectedRevision}, but current revision is ${currentRevision}. The file has been modified since you read it.`,
            );
          }
        }
      }

      for (const filePath of changedFiles) {
        const fullPath = path.join(workDir, filePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      }

      const patchFile = path.join(workDir, '.docu-guard-patch.tmp');
      await fs.promises.writeFile(patchFile, patchContent, 'utf-8');

      try {
        const applyResult = await git.raw([
          'apply',
          '--unidiff-zero',
          '--whitespace=nowarn',
          patchFile,
        ]);
        if (applyResult && applyResult.includes('error:')) {
          throw new Error(
            `Patch application failed: ${applyResult}`,
          );
        }
      } catch (err: unknown) {
        try {
          await fs.promises.unlink(patchFile);
        } catch { /* ignore */ }
        throw new Error(
          `Patch does not apply cleanly: ${(err as Error).message}`,
        );
      }

      // Clean up patch file
      try {
        await fs.promises.unlink(patchFile);
      } catch { /* ignore */ }

      await git.add(changedFiles);
      const result = await git.commit(message);
      await git.push('origin', branch);

      return {
        hash: result.commit,
        branch,
        message,
      };
    });
  }

  /**
   * Get the diff for a file between two revisions, or against HEAD.
   */
  async getDiff(
    branch: string,
    filePath: string,
    baseRevision?: string,
  ): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      if (baseRevision) {
        const result = await bareGit.diff([baseRevision, branch, '--', filePath]);
        return result;
      }
      // Show working tree diff vs HEAD
      const result = await bareGit.diff([branch, '--', filePath]);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get the history (log) for a file.
   */
  async getHistory(filePath: string, limit = 50): Promise<HistoryEntry[]> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const log = await bareGit.log({
        '--': filePath,
        maxCount: limit,
      });
      return log.all.map((entry) => ({
        hash: entry.hash,
        author: entry.author_name,
        date: entry.date,
        message: entry.message,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get the diff of a specific commit.
   */
  async getCommitDiff(revision: string): Promise<string | null> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const result = await bareGit.show([revision, '--format=""', '--']);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Restore a file from a specific revision to the working tree.
   */
  async restoreFile(
    branch: string,
    filePath: string,
    revision: string,
  ): Promise<CommitResult> {
    return this.withWorkDir(branch, async (git: SimpleGit, _workDir: string) => {
      // Checkout the file from the specified revision
      await git.raw(['checkout', revision, '--', filePath]);

      await git.add(filePath);
      const result = await git.commit(`Restore ${filePath} from revision ${revision.slice(0, 8)}`);
      await git.push('origin', branch);

      return {
        hash: result.commit,
        branch,
        message: `Restore ${filePath} from revision ${revision.slice(0, 8)}`,
      };
    });
  }

  /**
   * Export files from a branch to a target directory.
   */
  async exportBranch(branch: string, targetDir: string): Promise<string[]> {
    return this.withWorkDir(branch, async (_git: SimpleGit, _workDir: string) => {
      // List all tracked files in the branch
      const bareGit = simpleGit({ baseDir: this.repoPath });
      const filesOutput = await bareGit.raw(['ls-tree', '-r', '--name-only', branch]);
      const files = filesOutput
        .split('\n')
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0);

      const exported: string[] = [];

      for (const file of files) {
        const content = await this.readFileAtRevision(branch, file);
        if (content !== null) {
          const fullPath = path.join(targetDir, file);
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.promises.writeFile(fullPath, content, 'utf-8');
          exported.push(file);
        }
      }

      return exported;
    });
  }

  /**
   * List all files tracked in a branch.
   */
  async listFiles(branch = 'main'): Promise<string[]> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      const result = await bareGit.raw(['ls-tree', '-r', '--name-only', branch]);
      return result
        .split('\n')
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Check if a file exists in a branch.
   */
  async fileExists(branch: string, filePath: string): Promise<boolean> {
    const bareGit = simpleGit({ baseDir: this.repoPath });
    try {
      await bareGit.show([`${branch}:${filePath}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    try {
      await fs.promises.rm(this.workDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
