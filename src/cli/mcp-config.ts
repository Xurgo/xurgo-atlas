// ── MCP config guidance (read-only) ──────────────────────────────────────

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3737;

export interface McpConfigOptions {
  host?: string;
  port?: number;
  json?: boolean;
}

export function getMcpConfigUsageText(): string {
  return `
Print MCP client connection guidance for Xurgo Atlas.

USAGE:
  xurgo-atlas mcp-config [options]

OPTIONS:
  --host <host>    MCP server host (default: 127.0.0.1)
  --port <port>    MCP server port (default: 3737)
  --json           Print output as machine-readable JSON only

This is a read-only command. It does not create, modify, or delete any files.
It does not start or stop the daemon.
It does not require a project to be initialized.

EXAMPLES:
  xurgo-atlas mcp-config
  xurgo-atlas mcp-config --host 0.0.0.0 --port 3737
  xurgo-atlas mcp-config --json
`;
}

export function printMcpConfigUsage(): void {
  console.log(getMcpConfigUsageText());
}

export function getMcpConfigOutput(options: McpConfigOptions): string {
  const host = options.host || DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const endpoint = `http://${host}:${port}/mcp`;

  if (options.json) {
    return JSON.stringify(
      {
        mcpServers: {
          'xurgo-atlas': {
            url: endpoint,
          },
        },
      },
      null,
      2,
    );
  }

  return [
    `Xurgo Atlas MCP client configuration`,
    '',
    `Endpoint:`,
    `  ${endpoint}`,
    '',
    `Generic MCP client JSON:`,
    JSON.stringify(
      {
        mcpServers: {
          'xurgo-atlas': {
            url: endpoint,
          },
        },
      },
      null,
      2,
    ),
    '',
    `Notes:`,
    `- Start the daemon first with: xurgo-atlas daemon start`,
    `- Some clients may use a slightly different config shape.`,
    `- This command is read-only and does not write client config files.`,
  ].join('\n');
}

export function mcpConfigCommand(options: McpConfigOptions = {}): void {
  console.log(getMcpConfigOutput(options));
}
