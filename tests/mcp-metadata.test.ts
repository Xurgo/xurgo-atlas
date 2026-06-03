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

  it('registers docs.propose_patch with unified-diff guidance in tools/list', async () => {
    const server = createMcpServer(async () => {
      throw new Error('not used');
    });

    const handlers = (server as unknown as {
      _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: Array<{ name: string; description?: string; inputSchema: unknown }> }>>;
    })._requestHandlers;
    const listTools = handlers.get('tools/list');

    expect(listTools).toBeTypeOf('function');

    const result = await listTools!({
      method: 'tools/list',
      params: {},
    });
    const proposePatchTool = result.tools.find((tool) => tool.name === 'docs.propose_patch');

    expect(proposePatchTool).toBeDefined();
    expect(proposePatchTool?.description).toContain('standard unified diff');
    expect(proposePatchTool?.description).toContain('*** Begin Patch');
    expect(proposePatchTool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId', 'branch', 'path', 'baseRevision', 'patch', 'intent', 'summary'],
      properties: {
        patch: {
          type: 'string',
          description: expect.stringContaining('Standard unified diff patch text only.'),
        },
      },
    });
  });

  it('registers docs.propose_document in tools/list', async () => {
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
    const proposeDocumentTool = result.tools.find((tool) => tool.name === 'docs.propose_document');

    expect(proposeDocumentTool).toBeDefined();
    expect(proposeDocumentTool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId', 'mode', 'path', 'content', 'document', 'intent', 'summary'],
      properties: {
        mode: { enum: ['create'] },
        document: {
          type: 'object',
          required: ['role', 'summary'],
        },
      },
    });
  });
});
