import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Project } from '../core/project.js';
import { ProjectResolver } from './types.js';

/**
 * Register all MCP resources on the server.
 *
 * Accepts either a single Project (stdio mode) or a ProjectResolver
 * function (daemon mode). In daemon mode, resources are resolved
 * per-request based on the projectId embedded in the resource URI.
 */
export function registerResources(
  server: Server,
  projectOrResolver: Project | ProjectResolver,
): void {
  const isResolver = typeof projectOrResolver === 'function';

  // ── List resources ────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // In resolver mode, we need a project to list resources.
    // Try to resolve the default project; if none exists, return an
    // empty resource list with a helpful note.
    let project: Project;
    if (isResolver) {
      try {
        project = await (projectOrResolver as ProjectResolver)('');
      } catch {
        // No default project — return empty list
        return { resources: [] };
      }
    } else {
      project = projectOrResolver as Project;
    }

    const trackedFiles = await project.getTrackedFiles();
    const resources = [
      {
        uri: `docs://project/${project.projectId}/manifest`,
        name: `Docs Manifest for ${project.projectId}`,
        description: 'List of all tracked documentation files',
        mimeType: 'application/json',
      },
      {
        uri: `docs://project/${project.projectId}/policy`,
        name: `Docs Policy for ${project.projectId}`,
        description: 'Documentation policy configuration',
        mimeType: 'application/json',
      },
      ...trackedFiles.map((filePath) => ({
        uri: `docs://project/${project.projectId}/HEAD/${filePath}`,
        name: filePath,
        description: `Current version of ${filePath}`,
        mimeType: getMimeType(filePath),
      })),
    ];

    return { resources };
  });

  // ── Read resource ─────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (isResolver) {
      // In daemon mode, extract the projectId from the URI and resolve
      const resolver = projectOrResolver as ProjectResolver;
      const parsedGeneric = parseAnyResourceUri(uri);
      if (!parsedGeneric) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const project = await resolver(parsedGeneric.projectId);
      const parsed = parseResourceUri(uri, project.projectId);

      if (!parsed) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      return serveResource(project, uri, parsed);
    }

    // Single-project mode
    const project = projectOrResolver as Project;
    const parsed = parseResourceUri(uri, project.projectId);

    if (!parsed) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

    return serveResource(project, uri, parsed);
  });
}

// ── Resource serving ───────────────────────────────────────────────────

interface ParsedResource {
  type: 'manifest' | 'policy' | 'file' | 'history';
  branch: string;
  path: string;
}

async function serveResource(
  project: Project,
  uri: string,
  parsed: ParsedResource,
) {
  switch (parsed.type) {
    case 'manifest': {
      const files = await project.getTrackedFiles();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                projectId: project.projectId,
                files,
                branch: 'main',
                revision: await project.gitStore.getBranchHead('main'),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case 'policy': {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(project.policy.getConfig(), null, 2),
          },
        ],
      };
    }

    case 'file': {
      const { content, revision } = await project.readFile(
        parsed.branch,
        parsed.path,
      );
      return {
        contents: [
          {
            uri,
            mimeType: getMimeType(parsed.path),
            text:
              content ??
              JSON.stringify({
                projectId: project.projectId,
                path: parsed.path,
                branch: parsed.branch,
                revision,
                error: 'File not found',
              }),
          },
        ],
      };
    }

    case 'history': {
      const history = await project.gitStore.getHistory(parsed.path);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                projectId: project.projectId,
                path: parsed.path,
                history,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown resource type: ${parsed.type}`);
  }
}

// ── URI parsing ────────────────────────────────────────────────────────

function parseResourceUri(
  uri: string,
  projectId: string,
): ParsedResource | null {
  const prefix = `docs://project/${projectId}/`;

  if (!uri.startsWith(prefix)) {
    return null;
  }

  const rest = uri.slice(prefix.length);

  if (rest === 'manifest') {
    return { type: 'manifest', branch: 'main', path: '' };
  }

  if (rest === 'policy') {
    return { type: 'policy', branch: 'main', path: '' };
  }

  // Match: HEAD/<path>
  const headMatch = rest.match(/^HEAD\/(.+)/);
  if (headMatch) {
    return { type: 'file', branch: 'main', path: headMatch[1] };
  }

  // Match: branch/<branch>/<path>
  const branchMatch = rest.match(/^branch\/([^/]+)\/(.+)/);
  if (branchMatch) {
    return { type: 'file', branch: branchMatch[1], path: branchMatch[2] };
  }

  // Match: history/<path>
  const historyMatch = rest.match(/^history\/(.+)/);
  if (historyMatch) {
    return { type: 'history', branch: 'main', path: historyMatch[1] };
  }

  return null;
}

/**
 * Parse a resource URI to extract just the projectId, without needing
 * to know the projectId in advance. This is used in resolver mode when
 * the projectId is not known until the URI is parsed.
 *
 * Format: docs://project/{projectId}/...
 */
function parseAnyResourceUri(uri: string): { projectId: string } | null {
  const match = uri.match(/^docs:\/\/project\/([^/]+)\//);
  if (!match) {
    return null;
  }
  return { projectId: match[1] };
}

function getMimeType(filePath: string): string {
  if (filePath.endsWith('.md')) {
    return 'text/markdown';
  }
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
    return 'text/yaml';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json';
  }
  if (filePath.endsWith('.txt')) {
    return 'text/plain';
  }
  return 'text/plain';
}
