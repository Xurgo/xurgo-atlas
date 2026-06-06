# Daemon & MCP Configuration

## Daemon Lifecycle

```bash
# Start daemon in background
xurgo-atlas daemon start

# Stop daemon
xurgo-atlas daemon stop

# Check daemon status
xurgo-atlas daemon status

# Start daemon in foreground (for debugging)
xurgo-atlas daemon
```

The daemon runs on `http://127.0.0.1:3737` by default.

## MCP Endpoint

The daemon exposes a Streamable HTTP MCP endpoint:

```
POST http://127.0.0.1:3737/mcp
```

`GET /mcp` returning `404 Not Found` is expected and does not mean the daemon is broken.
`OPTIONS /mcp` is the CORS preflight path and may return `204 No Content`.
Raw `POST /mcp` requests should send compatible `Accept` headers that include `application/json` and `text/event-stream`, or the daemon may reply with `406 Not Acceptable`.
Prefer `xurgo-atlas daemon status` and actual MCP tool calls when verifying the daemon, rather than treating a browser `GET /mcp` check as authoritative.

## Quick Config Snippet

Run `xurgo-atlas mcp-config` to print a generic copy/paste MCP client configuration snippet:

```text
$ xurgo-atlas mcp-config
```

Use `xurgo-atlas mcp-config --json` for machine-readable JSON output. The command is read-only and does not write client config files.

## MCP Client Configuration

### opencode

```json
{
  "mcpServers": {
    "xurgo-atlas": {
      "type": "http",
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

### Other MCP Clients (HTTP)

Configure the endpoint `http://127.0.0.1:3737/mcp` with the Streamable HTTP transport.

### Stdio Mode (Local Development)

For direct integration:

```json
{
  "mcpServers": {
    "xurgo-atlas": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/xurgo-atlas/dist/index.js", "server"]
    }
  }
}
```

## MCP Tool Namespace

All documentation tools are exposed under the `docs.*` namespace:

| Tool | Purpose |
|------|---------|
| `docs.list` | List tracked files |
| `docs.read` | Read a file |
| `docs.read_section` | Read one Markdown section |
| `docs.status` | Read STATUS.md front matter and body |
| `docs.manifest` | Read project document manifest |
| `docs.context_pack` | Assemble curated doc pack within token budget |
| `docs.create_branch` | Create an isolated branch |
| `docs.propose_patch` | Propose a file change |
| `docs.propose_document` | Propose a new document |
| `docs.preview_diff` | Review a pending proposal diff |
| `docs.commit_patch` | Commit a proposed patch |
| `docs.history` | View file change history |
| `docs.restore_file` | Restore a file to a previous revision |
| `docs.export` | Export branch to working tree |

## Security

- The daemon binds to `127.0.0.1` (localhost) by default.
- Do not expose the endpoint to untrusted networks.
- Do not bind to `0.0.0.0` without verified network-level protections.
- The daemon does not implement authentication — rely on network-layer controls.
