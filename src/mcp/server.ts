import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Project } from '../core/project.js';
import { createMcpServer } from './create-server.js';

export interface ServerOptions {
  projectRoot: string;
  projectId: string;
  configDir?: string;
  dataDir?: string;
}

/**
 * Start an MCP server over stdio transport (v0.1 compatible).
 *
 * Creates a single Project instance, builds the shared MCP server
 * via createMcpServer(), then connects the StdioServerTransport.
 * The process stays alive until the transport closes.
 */
export async function startMcpServer(options: ServerOptions): Promise<void> {
  const project = await Project.load({
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    configDir: options.configDir,
    dataDir: options.dataDir,
  });

  const server = createMcpServer(project);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the transport closes
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
