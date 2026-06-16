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

For `0.1.0`, the daemon is single-project-bound. Startup resolves exactly one project from the current directory, `--project-root`, or an explicit registered `--project-id`; the background PID file records that bound project id and root. `daemon start` and `daemon status` output should identify the bound project when that information is available.

If a daemon is already running for the same resolved project, `daemon start` reports the existing daemon and exits successfully. If a daemon is already running for a different project, startup fails instead of silently reusing the daemon. Stop the current daemon before starting another project:

```bash
xurgo-atlas daemon stop
xurgo-atlas daemon start --project-id <other-project>
```

The bound daemon should not silently serve another project through MCP. MCP requests without a project id may use the bound project, and MCP requests for the bound project continue to work. MCP requests that name a different project id should fail clearly.

## MCP Endpoint

The daemon exposes a Streamable HTTP MCP endpoint:

```
POST http://127.0.0.1:3737/mcp
```

`GET /mcp` returning `404 Not Found` is expected and does not mean the daemon is broken.
`OPTIONS /mcp` is the CORS preflight path and may return `204 No Content`.
Raw `POST /mcp` requests should send compatible `Accept` headers that include `application/json` and `text/event-stream`, or the daemon may reply with `406 Not Acceptable`.
Prefer `xurgo-atlas daemon status` and actual MCP tool calls when verifying the daemon, rather than treating a browser `GET /mcp` check as authoritative.

## MCP Client Configuration

Run `xurgo-atlas mcp-config` for a human-readable setup summary.

Prefer `xurgo-atlas mcp-config --json` for machine-readable setup. The command is non-mutating, does not require the daemon to be running, and returns the authoritative HTTP MCP connection details for clients such as Xurgo Agent.

The JSON output includes:

- stable server metadata (`serverName`, `displayName`)
- transport (`streamable-http`)
- MCP endpoint URL (`http://127.0.0.1:3737/mcp` by default)
- a suggested daemon start command
- `projectId` and `projectRoot` when the current project can be resolved

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

`xurgo-atlas server` is the legacy stdio-oriented path. Prefer the daemon HTTP MCP endpoint for Xurgo Agent and other HTTP MCP clients. For direct stdio integration:

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
| `docs.list_proposals` | List proposal records and lifecycle state |
| `docs.discard_proposal` | Discard an uncommitted proposal safely |
| `docs.history` | View file change history |
| `docs.restore_file` | Restore a file to a previous revision |
| `docs.export` | Export branch to working tree |
| `docs.search` | Search Atlas-managed docs/context with local SQLite FTS |
| `docs.capabilities` | Report read-only Atlas capability and retrieval/search support |

## Proposal Lifecycle

Atlas proposals are audit records, not disposable scratch files. The normal lifecycle is `pending` -> `committed`, and uncommitted work can also end up in `stale`, `rejected`, or `discarded` states when validation changes or a draft is cleaned up.

Use `docs.list_proposals` to inspect active or historical proposal records. By default it returns pending proposals so stale internal drafts are easy to spot before they linger, and it can also be broadened to show committed or discarded records when you need a fuller audit view.

Use `docs.discard_proposal` when you need to retire a pending or otherwise uncommitted proposal by exact proposal id. The discard operation preserves the stored record, does not touch disk or the manifest for an uncommitted draft, and keeps committed proposals protected from discard by default.

After a proposal is committed, `docs.export` is the step that reconciles Atlas-managed branch content back to the working tree when the exported files need to be visible on disk. That export step remains separate from proposal cleanup and does not run when a draft is merely discarded.

Discarded proposals no longer appear in the default pending list, but they remain available in audit history and in broader `docs.list_proposals` queries.

## Security

- The daemon binds to `127.0.0.1` (localhost) by default.
- Do not expose the endpoint to untrusted networks.
- Do not bind to `0.0.0.0` without verified network-level protections.
- The daemon does not implement authentication — rely on network-layer controls.
