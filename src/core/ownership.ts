import YAML from 'yaml';
import { GitStore } from './git-store.js';

const CANONICAL_OWNED_PATHS = new Set([
  'STATUS.md',
  'AGENTS.md',
  '.docs-policy.yml',
  'docs/manifest.yml',
]);

const ATLAS_DOCS_PREFIX = 'docs/atlas/';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function isAlwaysOwnedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    CANONICAL_OWNED_PATHS.has(normalized) ||
    normalized.startsWith(ATLAS_DOCS_PREFIX)
  );
}

export async function getManifestDocumentPaths(
  gitStore: GitStore,
  branch = 'main',
): Promise<Set<string>> {
  const content = await gitStore.readFile(branch, 'docs/manifest.yml');
  if (!content) {
    return new Set();
  }

  try {
    const parsed = YAML.parse(content) as Record<string, unknown> | null;
    const documents = Array.isArray(parsed?.documents)
      ? parsed.documents
      : [];
    const paths = new Set<string>();

    for (const document of documents) {
      const filePath = (document as Record<string, unknown>)?.path;
      if (typeof filePath === 'string' && filePath.trim().length > 0) {
        paths.add(normalizePath(filePath));
      }
    }

    return paths;
  } catch {
    return new Set();
  }
}

export async function isPathOwned(
  gitStore: GitStore,
  branch: string,
  filePath: string,
): Promise<boolean> {
  const normalized = normalizePath(filePath);
  if (isAlwaysOwnedPath(normalized)) {
    return true;
  }

  const manifestPaths = await getManifestDocumentPaths(gitStore, branch);
  return manifestPaths.has(normalized);
}

export async function listOwnedPaths(
  gitStore: GitStore,
  branch = 'main',
): Promise<string[]> {
  const [trackedFiles, manifestPaths] = await Promise.all([
    gitStore.listFiles(branch),
    getManifestDocumentPaths(gitStore, branch),
  ]);

  return trackedFiles.filter((filePath) => {
    const normalized = normalizePath(filePath);
    return isAlwaysOwnedPath(normalized) || manifestPaths.has(normalized);
  });
}
