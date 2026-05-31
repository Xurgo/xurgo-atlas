import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Project } from '../core/project.js';

export function registerResources(server: Server, project: Project): void {
  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
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

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const parsed = parseResourceUri(uri, project.projectId);

    if (!parsed) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

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
  });
}

interface ParsedResource {
  type: 'manifest' | 'policy' | 'file' | 'history';
  branch: string;
  path: string;
}

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
