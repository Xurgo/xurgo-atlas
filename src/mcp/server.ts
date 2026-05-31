import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Project } from '../core/project.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export interface ServerOptions {
  projectRoot: string;
  projectId: string;
}

export async function startMcpServer(options: ServerOptions): Promise<void> {
  const project = await Project.load({
    projectRoot: options.projectRoot,
    projectId: options.projectId,
  });

  const server = new Server(
    {
      name: 'docs-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tools
  registerTools(server, project);

  // Register resources
  registerResources(server, project);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the transport closes
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
