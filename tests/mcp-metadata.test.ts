import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp/create-server.js';

describe('MCP server metadata', () => {
  it('defaults the server name to Xurgo Atlas', () => {
    const server = createMcpServer(async () => {
      throw new Error('not used');
    });

    expect((server as unknown as { _serverInfo?: { name?: string } })._serverInfo?.name).toBe('Xurgo Atlas');
  });

  it('registers docs.preview_diff in tools/list', async () => {
    const server = createMcpServer(async () => {
      throw new Error('not used');
    });

    const handlers = (server as unknown as {
      _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: Array<{ name: string; inputSchema: unknown }> }>>;
    })._requestHandlers;
    const listTools = handlers.get('tools/list');

    expect(listTools).toBeTypeOf('function');

    const result = await listTools!({
      method: 'tools/list',
      params: {},
    });
    const previewTool = result.tools.find((tool) => tool.name === 'docs.preview_diff');

    expect(previewTool).toBeDefined();
    expect(previewTool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId', 'proposalId'],
    });
  });
});
