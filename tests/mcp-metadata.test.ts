import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp/create-server.js';

describe('MCP server metadata', () => {
  it('defaults the server name to Xurgo Atlas', () => {
    const server = createMcpServer(async () => {
      throw new Error('not used');
    });

    expect((server as unknown as { _serverInfo?: { name?: string } })._serverInfo?.name).toBe('Xurgo Atlas');
  });
});
