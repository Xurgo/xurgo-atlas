import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Project } from '../core/project.js';
import { ProjectResolver } from './types.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export interface CreateServerOptions {
  name?: string;
  version?: string;
}

/**
 * Create an MCP Server instance with all tools and resources registered,
 * but without connecting a transport. This shared factory is used by
 * both stdio mode (v0.1 compatible) and the HTTP daemon (v0.2).
 *
 * @param projectOrResolver - Either a single Project instance (stdio mode)
 *                            or a ProjectResolver function (daemon mode).
 * @param options - Optional server name and version overrides.
 */
export function createMcpServer(
  projectOrResolver: Project | ProjectResolver,
  options: CreateServerOptions = {},
): Server {
  const server = new Server(
    {
      name: options.name || 'docu-guard-mcp',
      version: options.version || '0.2.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tools and resources
  registerTools(server, projectOrResolver);
  registerResources(server, projectOrResolver);

  return server;
}
