# PRD: docu-guard-mcp v0.2 — Multi-Project Daemon with Streamable HTTP Transport

## 1. Problem Statement

v0.1 of `docu-guard-mcp` is a stdio-based MCP server that manages exactly one project per process. This has several limitations:

- **One project per terminal.** Running a separate `docu-guard server` process for each project is cumbersome when working across multiple repositories.
- **Stdio coupling.** The server is tied to the lifecycle of the MCP client. If the client restarts, the server's in-memory state is lost. There is no way to keep a long-lived server running independently.
- **No project registry.** There is no central place to register, list, and manage which projects are under docu-guard control.
- **No HTTP transport.** MCP supports Streamable HTTP as a first-class transport, but docu-guard only implements stdio. Some MCP clients and workflows benefit from a persistent HTTP endpoint.

v0.2 addresses these limitations by introducing a long-lived daemon mode with a Streamable HTTP endpoint and a local project registry, while preserving full backward compatibility with the existing stdio mode.

---

## 2. Goals

### Primary Goals

1. **Add daemon mode.** `docu-guard daemon` starts a long-lived HTTP server that can manage multiple projects from a single process.
2. **Add Streamable HTTP transport.** The daemon exposes an HTTP endpoint at `http://127.0.0.1:3737/mcp` that implements the MCP Streamable HTTP specification.
3. **Add a local project registry.** A JSON-based registry at `~/.config/docu-guard/projects.json` maps `projectId` to `projectRoot`, allowing the daemon to resolve and load projects dynamically.
4. **Add project CLI commands.** `docu-guard project add`, `docu-guard project remove`, `docu-guard project list`, `docu-guard project show`, `docu-guard project default`.
5. **Preserve stdio compatibility.** All existing v0.1 stdio behavior must continue to work unchanged.
6. **Support multi-project tool dispatch.** Tools that accept `projectId` resolve the project through the registry when running in daemon mode.
7. **Add default project fallback.** When `projectId` is omitted and a default is set, the daemon uses the default project.

### Secondary Goals

1. Error messages clearly guide the user to initialize unregistered projects.
2. The daemon logs startup, registration, and request events to stderr (not to stdout, which is reserved for MCP stdio clients).
3. The daemon gracefully handles project roots that have been moved or deleted.
4. Origin header validation for browser-originated HTTP requests (future-proofing).

---

## 3. Non-Goals

The following are explicitly out of scope for v0.2:

1. **Authentication.** No bearer token, API key, or auth flow in the first v0.2 release. The daemon binds to localhost only by default. Authentication may be added in a future version when remote access is needed.
2. **Cloud hosting.** The daemon is designed for local use only.
3. **Binding to `0.0.0.0` by default.** The daemon defaults to `127.0.0.1`. Binding to all interfaces requires an explicit `--host 0.0.0.0` flag and is documented as unsafe without authentication.
4. **Consolidating per-project stores.** Each project retains its own `.docu-guard/` directory with its own Git bare repo and SQLite event log. No global database is introduced.
5. **Merging stdio and daemon into a single transport.** Stdio remains stdio; HTTP remains HTTP. They are separate entry points.
6. **Web UI.** No graphical interface is built in v0.2.
7. **npm publish.** Not part of this release.
8. **Remote access.** The daemon is intended for localhost only.
9. **TLS/HTTPS.** The daemon serves plain HTTP on localhost. TLS may be added in a future version.

---

## 4. Architecture

### 4.1 High-Level Design

```
┌─────────────────────────────────────────────────┐
│                  docu-guard daemon               │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         Shared MCP Server Instance        │   │
│  │  (tools.ts + resources.ts registration)   │   │
│  └──────────────┬───────────────────────────┘   │
│                 │                                │
│        ┌────────┴────────┐                      │
│        ▼                 ▼                       │
│  ┌──────────┐    ┌──────────────┐               │
│  │   Stdio  │    │ Streamable   │               │
│  │ Transport│    │ HTTP Transport│              │
│  └──────────┘    └──────────────┘               │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          Project Registry                 │   │
│  │  ~/.config/docu-guard/projects.json       │   │
│  │  { projectId → projectRoot }             │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  Project A   │  │  Project B   │   ...       │
│  │  .docu-guard/│  │  .docu-guard/│             │
│  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────┘
```

### 4.2 Transport Separation

The existing `server.ts` creates an MCP `Server` instance, registers tools and resources, and connects to a `StdioServerTransport`. In v0.2:

1. **`create-server.ts`** is extracted from `server.ts` — it creates the MCP `Server` instance and registers tools/resources, but does **not** connect a transport. This shared registration logic is used by both stdio and HTTP modes.
2. **`stdio.ts`** wraps the stdio transport (existing behavior, unchanged).
3. **`http.ts`** wraps the Streamable HTTP transport using Node.js built-in `http` module (no Express dependency).

### 4.3 Project Resolution Flow (Daemon Mode)

```
Request arrives with projectId (or uses default)
        │
        ▼
Registry.lookup(projectId)
        │
        ├── Not found → error: "Project '<id>' not found in registry.
        │                 Use 'docu-guard project add' to register it."
        │
        ├── Found, root missing → error: "Project root for '<id>'
        │   does not exist at <path>."
        │
        ├── Found, not initialized → error: "Project '<id>' has not
        │   been initialized. Run 'docu-guard init --project-root
        │   <path> --project-id <id>' first."
        │
        └── Found, valid → load Project, dispatch tool
```

---

## 5. CLI Commands

### 5.1 New Daemon Command

```
docu-guard daemon [options]

Options:
  --host <host>     Host to bind to (default: 127.0.0.1)
  --port <port>     Port to listen on (default: 3737)
  --project-id <id> Optional: register a project on startup
  --project-root <path>  Optional: project root (used with --project-id)
```

Examples:

```bash
# Start daemon with default host/port
docu-guard daemon

# Start daemon and register a project on startup
docu-guard daemon --project-id my-app --project-root /path/to/my-app

# Start daemon on a custom port
docu-guard daemon --port 3737

# Bind to all interfaces (unsafe without auth)
docu-guard daemon --host 0.0.0.0 --port 3737
```

### 5.2 New Project Registry Commands

```
docu-guard project add --project-id <id> --project-root <path>
docu-guard project remove --project-id <id>
docu-guard project list
docu-guard project show --project-id <id>
docu-guard project default --project-id <id>
```

Examples:

```bash
# Register a project
docu-guard project add --project-id my-app --project-root /home/jason/projects/my-app

# Remove a project from registry
docu-guard project remove --project-id my-app

# List all registered projects
docu-guard project list

# Show details for a project
docu-guard project show --project-id my-app

# Set the default project (used when projectId is omitted in daemon mode)
docu-guard project default --project-id my-app
```

### 5.3 Updated Stdio Command (Unchanged)

```
docu-guard server --project-root <path> --project-id <id>
```

The `server` command remains identical to v0.1. No changes to its behavior or interface.

---

## 6. Project Registry Design

### 6.1 Storage Location

```
~/.config/docu-guard/projects.json
```

The directory `~/.config/docu-guard/` is created automatically when the first project is added.

### 6.2 Schema

```json
{
  "version": 1,
  "defaultProjectId": "my-app",
  "projects": {
    "my-app": {
      "projectId": "my-app",
      "projectRoot": "/home/jason/projects/my-app",
      "createdAt": "2026-05-30T10:00:00.000Z",
      "updatedAt": "2026-05-30T10:00:00.000Z"
    },
    "my-other-app": {
      "projectId": "my-other-app",
      "projectRoot": "/home/jason/projects/my-other-app",
      "createdAt": "2026-05-30T11:00:00.000Z",
      "updatedAt": "2026-05-30T11:00:00.000Z"
    }
  }
}
```

### 6.3 Registry Operations

| Operation | Method | Description |
|-----------|--------|-------------|
| Add | `addProject(id, root)` | Adds or updates a project entry; creates the config directory if missing |
| Remove | `removeProject(id)` | Removes a project entry; does not delete the project data on disk |
| List | `listProjects()` | Returns all registered project entries |
| Show | `getProject(id)` | Returns a single project entry or null |
| Set default | `setDefault(id)` | Sets `defaultProjectId`; must reference an existing project |
| Resolve | `resolve(id)` | Returns `{ projectId, projectRoot }` or throws a descriptive error |

### 6.4 Thread Safety

Since Node.js is single-threaded and all MCP tool calls are async/await, there is no concurrent write contention for the registry JSON file. A simple read-write pattern with `fs.promises` is sufficient for v0.2.

### 6.5 Relationship to Per-Project Stores

The registry does **not** replace per-project `.docu-guard/` stores. Each project remains self-contained:

- `.docu-guard/repo.git` — Git-backed documentation history
- `.docu-guard/events.sqlite` — SQLite event audit log
- `.docu-guard/exports/` — Export output directory

The registry simply maps `projectId` → `projectRoot` so the daemon can load the correct project by ID.

---

## 7. Streamable HTTP Transport Design

### 7.1 Specification

The Streamable HTTP transport follows the [MCP Streamable HTTP Specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/). Key properties:

- **Single endpoint:** All MCP messages are sent to `POST http://127.0.0.1:3737/mcp`.
- **JSON-RPC over HTTP:** Requests and responses use JSON-RPC 2.0.
- **Sessionless by default:** Each HTTP request is independent. The server does not maintain client sessions (unless the client negotiates a session).
- **Streaming support:** The server can return `text/event-stream` for responses that include notifications or multiple messages.
- **CORS headers:** The server returns appropriate CORS headers for browser-originated requests.

### 7.2 Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | MCP JSON-RPC endpoint |
| `GET` | `/health` | Health check (returns `{ "status": "ok" }`) |

### 7.3 Request Flow

```
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "docs.read",
    "arguments": {
      "projectId": "my-app",
      "path": "docs/README.md",
      "branch": "main"
    }
  }
}
```

### 7.4 Response Flow

For simple request-response patterns:

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [...]
  }
}
```

For streaming responses (e.g., progress notifications):

```
HTTP/1.1 200 OK
Content-Type: text/event-stream

event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":50}}

event: message
data: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}
```

### 7.5 CORS Configuration

```
Access-Control-Allow-Origin: *        (or configurable origin for browser clients)
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept
Access-Control-Max-Age: 86400
```

Preflight `OPTIONS` requests are handled automatically.

### 7.6 Server-Sent Events (SSE)

The transport returns `text/event-stream` when:

- The client sends `Accept: text/event-stream`.
- The response includes progress notifications.
- The response includes multiple messages (e.g., tool results + notifications).

For simple request-response without streaming, the transport returns `application/json`.

### 7.7 Error Handling

| HTTP Status | When |
|-------------|------|
| `200` | Successful JSON-RPC response (including JSON-RPC errors) |
| `400` | Malformed JSON or missing required headers |
| `405` | Method not allowed (only POST and OPTIONS are accepted for `/mcp`) |
| `500` | Internal server error (unexpected exceptions) |

---

## 8. Security Model

### 8.1 Default Binding

The daemon binds to `127.0.0.1` (localhost only) by default. This ensures the daemon is not accessible from other machines on the network.

### 8.2 Explicit Binding to All Interfaces

Binding to `0.0.0.0` requires the explicit `--host 0.0.0.0` flag. The daemon prints a warning when binding to a non-loopback address:

```
WARNING: Binding to 0.0.0.0 makes the MCP server accessible to all
machines on the network. This is unsafe without authentication.
```

### 8.3 Origin Header Validation

The daemon checks the `Origin` header on incoming requests:

- If `Origin` is missing or matches `null` (non-browser clients), the request is allowed.
- If `Origin` is present and does not match an allowed origin, the request is rejected with `403`.
- By default, allowed origins include `null` and any origin matching `http://127.0.0.1:*` or `http://localhost:*`.
- Custom allowed origins can be added via `--allow-origin` flag.

### 8.4 Authentication (Not in v0.2)

No authentication is required in v0.2 because:

- The daemon binds to localhost by default.
- Only local processes can reach the daemon.
- The daemon does not expose file system access beyond docu-guard's controlled MCP tools.

Authentication (e.g., bearer token) will be added in a future version when remote access or multi-user support is introduced.

### 8.5 Host Validation

The `--host` flag validates that the provided value is a valid IP address or hostname. Invalid values are rejected at startup with a clear error message.

---

## 9. Compatibility with Stdio Mode

### 9.1 Guarantees

1. **All v0.1 CLI commands work identically.** `docu-guard server`, `docu-guard init`, `docu-guard list`, `docu-guard history`, `docu-guard export` — none of these change.
2. **All MCP tools work identically.** `docs.read`, `docs.list`, `docs.create_branch`, `docs.propose_patch`, `docs.preview_diff`, `docs.commit_patch`, `docs.history`, `docs.restore_file`, `docs.export` — all behavior, inputs, and outputs are preserved.
3. **All MCP resources work identically.** All resource URIs continue to return the same data.
4. **Per-project `.docu-guard/` stores are unchanged.** No migration is required.
5. **Stdio and HTTP serve the same tools/resources.** The registration is shared; both transports expose the same interface.

### 9.2 What Changes

1. `src/mcp/server.ts` is refactored into `src/mcp/create-server.ts` (shared registration) + `src/mcp/stdio.ts` (transport wrapper).
2. The `Project` class gets a static cache or the daemon creates `Project` instances per request (lazy-loaded, cached in memory for the daemon lifetime).
3. A new `Registry` class is introduced.

### 9.3 Migration Path

Users of v0.1 do not need to change anything. They can continue using `docu-guard server --project-root .` as before. The v0.2 daemon mode is purely additive.

To migrate from a single stdio server to the daemon:

1. Register the project: `docu-guard project add --project-id my-app --project-root /path/to/my-app`
2. Start the daemon: `docu-guard daemon`
3. Update MCP client config to point to `http://127.0.0.1:3737/mcp` instead of stdio.
4. Or keep stdio — both work.

---

## 10. Acceptance Criteria

v0.2 is complete when:

### Daemon Mode

1. `docu-guard daemon` starts and binds to `127.0.0.1:3737`.
2. `docu-guard daemon --port 9090` starts and binds to the specified port.
3. `docu-guard daemon --host 0.0.0.0` starts with a warning about unsafe binding.
4. The `/health` endpoint returns `{ "status": "ok" }`.
5. The `/mcp` endpoint responds to MCP JSON-RPC `tools/list` requests.
6. The `/mcp` endpoint responds to MCP JSON-RPC `tools/call` requests.
7. The `/mcp` endpoint responds to MCP JSON-RPC `resources/list` requests.
8. The `/mcp` endpoint responds to MCP JSON-RPC `resources/read` requests.
9. The daemon handles multiple concurrent requests.
10. The daemon gracefully handles `SIGINT` and `SIGTERM` for shutdown.

### Project Registry

1. `docu-guard project add --project-id my-app --project-root /path` creates a registry entry.
2. `docu-guard project list` shows all registered projects.
3. `docu-guard project show --project-id my-app` shows project details.
4. `docu-guard project remove --project-id my-app` removes the entry.
5. `docu-guard project default --project-id my-app` sets the default.
6. The registry persists across daemon restarts.
7. The registry file is valid JSON after every write.

### Multi-Project Resolution

1. A tool call with a valid `projectId` resolves correctly through the registry.
2. A tool call with an unknown `projectId` returns a clear error.
3. A tool call without `projectId` and with a default set uses the default project.
4. A tool call without `projectId` and without a default returns a clear error.
5. A tool call for a project whose root has been deleted returns a clear error.
6. A tool call for a project that has not been initialized returns a clear error suggesting `docu-guard init`.

### Stdio Compatibility

1. All v0.1 tests still pass (25/25).
2. `docu-guard server --project-root . --project-id test` works as before.
3. All MCP tools return identical results via stdio and HTTP.

---

## 11. Test Plan

### Unit Tests

| Test Area | Tests | Description |
|-----------|-------|-------------|
| Registry | 8-10 | add, remove, list, show, set default, resolve, persistence, error cases |
| HTTP server | 6-8 | startup, health, MCP endpoint, CORS, OPTIONS, shutdown |
| Multi-project dispatch | 6-8 | valid resolve, unknown project, default fallback, missing default, deleted root, uninitialized project |
| Origin validation | 4-5 | valid origin, invalid origin, missing origin, browser origin |

### Integration Tests

| Test Area | Tests | Description |
|-----------|-------|-------------|
| HTTP tool call | 3-5 | Call each tool type via HTTP and verify response matches stdio |
| Registry + daemon | 2-3 | Register project, start daemon, call tool |

### Regression Tests

All 25 v0.1 tests must pass with no changes.

---

## 12. Error Messages

All error messages should follow the existing v0.1 style: clear, actionable, and specific.

| Scenario | Error Message |
|----------|---------------|
| Project not in registry | `Project '<id>' not found in registry. Use 'docu-guard project add --project-id <id> --project-root <path>' to register it.` |
| Project root missing | `Project root for '<id>' does not exist at <path>. Update the path with 'docu-guard project add --project-id <id> --project-root <new-path>'.` |
| Project not initialized | `Project '<id>' has not been initialized. Run 'docu-guard init --project-root <path> --project-id <id>' first.` |
| No projectId and no default | `No projectId provided and no default project is set. Provide --project-id or set a default with 'docu-guard project default --project-id <id>'.` |
| Invalid host | `Invalid host '<host>'. Must be a valid IP address or hostname.` |
| Port in use | `Port <port> is already in use. Specify a different port with --port.` |

---

## 13. Future Considerations (Post-v0.2)

1. **Bearer token authentication** for non-localhost binding.
2. **TLS/HTTPS support** for secure remote access.
3. **Per-project access controls** within the registry.
4. **WebSocket transport** for persistent bidirectional communication.
5. **Global event log** aggregating events across all registered projects.
6. **`docu-guard doctor`** diagnostic command to verify project registry integrity.
7. **`docu-guard status`** command showing daemon health and registered project states.
8. **Auto-discovery** of projects by scanning the filesystem.

---

## 14. Summary

v0.2 transforms `docu-guard-mcp` from a single-project stdio server into a multi-project daemon with Streamable HTTP transport, while preserving full backward compatibility. The key additions are:

- `docu-guard daemon` — long-lived HTTP server
- `POST /mcp` — Streamable HTTP endpoint
- `docu-guard project` — registry management commands
- `~/.config/docu-guard/projects.json` — registry storage
- Shared MCP server registration — extracted for both stdio and HTTP

The design is incremental, not revolutionary. Every existing feature continues to work. Users who want a simpler single-project setup can keep using `docu-guard server`. Users who manage multiple projects can adopt the daemon mode at their own pace.
