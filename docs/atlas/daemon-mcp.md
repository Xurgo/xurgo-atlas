# Daemon, CLI & MCP Reference

## Install and Invocation Boundaries

Install Xurgo Atlas globally for the normal CLI path:

```bash
npm install -g xurgo-atlas
```

Other supported invocation paths are:

- `npx xurgo-atlas ...` for ad hoc use without a global install
- `npm install -D xurgo-atlas` for project-local automation
- this repository checkout plus a current local build when you are working on Atlas itself

The installed CLI entrypoint is `xurgo-atlas`.

- `xurgo-atlas -v` prints one `xurgo-atlas <version>` line and exits `0`.
- `xurgo-atlas --version` does the same.
- `xurgo-atlas --help` prints the top-level usage text and exits `0`.

If you are developing Atlas from this repo, prefer the checked-out source and local build here over a previously installed global copy. A running daemon or globally installed CLI may be version-skewed from your checkout.

## Daemon Lifecycle and Project Binding

`xurgo-atlas daemon` manages the preferred Streamable HTTP MCP server:

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

The registry may record multiple projects, but each running daemon instance is currently bound to one resolved project/root at a time. Startup resolves exactly one project from the current directory, `--project-root`, or an explicit registered `--project-id`; the background PID file records that bound project id and root. `daemon start` and `daemon status` should identify the bound project when that information is available.

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

Atlas is optional for Studio and other consumers. Use it when a client wants governed docs and Atlas project context through MCP; do not treat Atlas as a required dependency for every consumer.

## MCP Client Configuration

Run `xurgo-atlas mcp-config` for a human-readable setup summary.

Prefer `xurgo-atlas mcp-config --json` for machine-readable setup. It is the canonical client configuration and discovery boundary.

`xurgo-atlas mcp-config --json` does not modify project source files, Atlas-managed docs, or Git state. It may refresh local descriptive root-observation runtime metadata that Atlas uses for root/worktree reporting. It does not start or stop the daemon, and it does not require the daemon to be running.

The JSON output includes:

- stable server metadata (`serverName`, `displayName`)
- transport (`streamable-http`)
- MCP endpoint URL (`http://127.0.0.1:3737/mcp` by default)
- a suggested daemon start command
- `projectId` and `projectRoot` when the current project can be resolved
- Git identity fields under `git`
- the authoritative write-safety snapshot under `safety`
- descriptive root/worktree history under `rootLedger`

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

`xurgo-atlas server` remains the legacy stdio-oriented path. Prefer the daemon HTTP MCP endpoint for HTTP MCP clients. For direct stdio integration:

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

## Root Context and `safeForWrites`

The `safety.safeForWrites` field is the authoritative client signal for mutating Atlas boundaries.

- `safeForWrites: true` means Atlas considers the current resolved project/root binding safe for guarded write flows such as proposal commit, restore, and export.
- `safeForWrites: false` means clients should stay read-only and surface the mismatch or ambiguity to the operator instead of guessing.
- The other `safety` flags explain why writes are unsafe or ambiguous.
- `rootLedger` is descriptive context for coordinators and debugging. It does not override `safeForWrites`.

Connected clients can see the same root-safety concepts in managed-doc reads such as `docs.status`, where they are reported under `rootContext`.

## Live Capability Discovery

After a client connects, use normal MCP discovery and treat live `tools/list` from the connected server as the authoritative capability surface.

Trust live `tools/list` over static docs, local source, or checked-out tests when they disagree. A running daemon may be stale or version-skewed from the source tree on disk.

Use `docs.capabilities` only as supplemental summary context. It is useful for broad read/search/write feature posture, but it is not the authoritative tool registry.

## Supported Tools

A fresh live daemon should advertise its supported tools through `tools/list`. The currently supported public `docs.*` surface is:

### Discovery and read-only context

- `docs.list`
- `docs.read`
- `docs.read_section`
- `docs.status`
- `docs.manifest`
- `docs.context_pack`
- `docs.history`
- `docs.search`
- `docs.capabilities`

### Guarded branch and proposal workflow

- `docs.create_branch`
- `docs.propose_patch`
- `docs.propose_document`
- `docs.preview_diff`
- `docs.list_proposals`
- `docs.discard_proposal`
- `docs.commit_patch`
- `docs.restore_file`

### Export workflow

- `docs.preview_export`
- `docs.export`

Some current builds also register a compact read-only `atlas.project_identity` helper in addition to the `docs.*` tools above. Treat it as optional unless the connected daemon advertises it in `tools/list`.

## Proposal Lifecycle

Atlas proposals are audit records, not disposable scratch files. The normal lifecycle is `pending` -> `committed`, and uncommitted work can also end up in `stale`, `rejected`, or `discarded` states when validation changes or a draft is cleaned up.

Use `docs.list_proposals` to inspect active or historical proposal records. By default it returns pending proposals so stale internal drafts are easy to spot before they linger, and it can also be broadened to show committed or discarded records when you need a fuller audit view.

Use `docs.discard_proposal` when you need to retire a pending or otherwise uncommitted proposal by exact proposal id. The discard operation preserves the stored record, does not touch disk or the manifest for an uncommitted draft, and keeps committed proposals protected from discard by default. That makes it the recovery cleanup path when the root context is unsafe, because it does not depend on managed-doc write safety.

After a proposal is committed, `docs.preview_export` is read-only with respect to disk, managed document content, manifest state, proposal state, and working-tree files. It shows what `docs.export` would add, modify, or overwrite on disk before any export write happens. The preview reports managed and source revisions when available, highlights drift and overwrite risk, and is especially helpful when managed state or the checked-out source branch may be stale. `rootContext.recovery` adds descriptive pending-proposal counts, foreign-root proposal signals, and the latest preview/export recovery breadcrumbs so coordinators can see when cleanup may be needed. Atlas may record those recovery breadcrumbs in internal event storage for later status and preview reporting, but that breadcrumb write is best-effort only and must not make `docs.preview_export` fail when the preview itself succeeds. Those recovery fields do not change enforcement: `safety.safeForWrites` and the existing `docs.export` guard remain authoritative, and `docs.discard_proposal` remains the cleanup path for stale pending proposals. `docs.export` remains the mutating step that reconciles Atlas-managed branch content back to the working tree when the exported files need to be visible on disk. That export step remains separate from proposal cleanup and does not run when a draft is merely discarded.

Discarded proposals no longer appear in the default pending list, but they remain available in audit history and in broader `docs.list_proposals` queries.

## Security

- The daemon binds to `127.0.0.1` (localhost) by default.
- Do not expose the endpoint to untrusted networks.
- Do not bind to `0.0.0.0` without verified network-level protections.
- The daemon does not implement authentication; rely on network-layer controls.
