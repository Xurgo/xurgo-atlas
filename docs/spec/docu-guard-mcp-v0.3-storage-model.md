# docu-guard-mcp v0.3 Storage Model Proposal

## Current Behavior

As of v0.2, `docu-guard init` creates the following inside every target project:

| Path | Purpose | Type |
|------|---------|------|
| `./.docu-guard/repo.git` | Bare Git repository — full docs history | Managed state |
| `./.docu-guard/events.sqlite` | SQLite database — events, proposals | Managed state |
| `./.docs-policy.yml` | Documentation policy (protected paths, risk rules) | Project file |
| `./docs/` | Documentation directory with initial templates | Project file |
| `./AGENTS.md` | Agent safety rules for docu-guard-mcp | Project file |

The **project registry** lives globally at `~/.config/docu-guard/projects.json` (or `$XDG_CONFIG_HOME/docu-guard/projects.json`).

The registry maps `projectId → projectRoot` only. It stores no information about storage location.

### Key observations from source code

- `src/core/project.ts` line 74: `this.docsMcpDir = path.join(this.root, '.docu-guard')`
- `src/core/project.ts` line 74-75: `gitStore` at `.docu-guard/repo.git`, `eventLog` at `.docu-guard/events.sqlite`
- `src/core/registry.ts` lines 38-44: Registry at `~/.config/docu-guard/projects.json`
- `src/core/registry.ts` line 264: Validation checks `projectRoot/.docu-guard` existence
- `.gitignore` contains `.docu-guard/` — it is not committed

---

## Problem

The current project-local `.docu-guard/` store model has several limitations that become more acute as docu-guard-mcp evolves toward v0.3 (web UI) and beyond:

1. **Repo bloat.** A bare Git repo inside every project adds ~400 KB+ of binary data. The SQLite DB grows with every proposal and event. These are implementation details that pollute the project directory.

2. **Daemon-mode redundancy.** In daemon mode (v0.2), the daemon already manages multiple projects via a global registry. Having each project carry its own `.docu-guard/` means the daemon must read/write to potentially many scattered directories. A centralized store is more natural for a daemon.

3. **Backup complexity.** Users must remember to include `.docu-guard/` in backups. The `.gitignore` excludes it, so `git push` does not back up history.

4. **No history portability across machines.** Cloning a repo from GitHub does not bring docu-guard history with it, because `.docu-guard/` is gitignored.

5. **Monorepo and submodule friction.** In workspaces with multiple packages or git submodules, each sub-project having its own `.docu-guard/` creates unnecessary duplication and management overhead.

6. **Web UI architecture.** A future web UI would ideally read managed state from a centralized location, not from scattered project directories. A global store simplifies the web UI's data access layer.

7. **Multi-agent conflict potential.** Multiple agents working on the same project via the daemon share the same `.docu-guard/` Git bare repo on disk. While Git handles this well, SQLite contention could become an issue with concurrent writes (though Node.js single-threaded model mitigates this).

8. **Deployment inflexibility.** The current model does not differentiate between desktop, server/VPS, Docker, and cloud environments. Each deployment type needs a different storage layout, but the model is hard-coded to project-local directories.

---

## Goals

1. Keep project-facing documentation files (`docs/`, `AGENTS.md`, `.docs-policy.yml`) in the project where users expect them.
2. Move all managed tool state (Git bare repo, SQLite DB) outside the project working tree into daemon-owned storage.
3. Support configurable config and data directories so the same code works on desktop, VPS, and Docker.
4. Provide sensible defaults for each deployment environment.
5. Enable a clean multi-project daemon architecture where the daemon manages all state from a single global directory tree.
6. Lay the foundation for the v0.3 web UI by centralizing where managed state lives.
7. Support centralized backup by keeping all managed state under one root.
8. Remove the complexity of maintaining two code paths (project-local vs global).

## Non-Goals

1. No storage migration implementation in this document — this is a planning pass only.
2. No web UI implementation.
3. Project-local `.docu-guard/` is **removed** as a first-class supported storage mode. The v0.3 model uses only global/managed storage with configurable config and data directories. Existing v0.1/v0.2 `.docu-guard/` directories must be migrated; the old store mode is not preserved.
4. No authentication or TLS for the daemon in this planning pass (noted as future work).
5. No `docu-guard init --store project` flag — only one storage mode exists.
6. No migration command required yet — migration strategy will be designed during implementation.
7. No changes to the MCP tool interface — all tools continue to accept the same parameters.

---

## Options Considered

### Option A: Project-local store only (current v0.2 behavior)

```
/project/.docu-guard/repo.git
/project/.docu-guard/events.sqlite
/project/.docs-policy.yml
/project/docs/
/project/AGENTS.md
```

**Pros:**
- Everything self-contained in the project.
- Git clone gives you everything (except history, since `.docu-guard/` is gitignored).
- Simple mental model — one project, one store.
- No changes needed — current behavior.

**Cons:**
- Bloats the project with binary/transient data.
- Daemon mode reads from many scattered directories.
- History not portable across clones (gitignored).
- Web UI would need to discover stores by scanning projects.
- SQLite DB inside project is unusual and may confuse users.
- No deployment flexibility — works only for desktop local use.

### Why project-local state was considered (use cases we evaluated)

During the planning pass, these valid use cases for project-local managed state were identified:

1. **Portable bundles.** A project directory that can be moved between machines (e.g., USB drive) carrying its docu-guard history with it.
2. **Team-shared state.** A team working on the same machine or shared filesystem where the `.docu-guard/` directory is visible to all.
3. **Air-gapped handoff.** Passing a complete project (with history) to an environment with no network access.
4. **Project-mounted cloud worker.** A cloud CI/CD worker that clones the project and needs docu-guard history immediately.
5. **Debugging/transparency.** Users can inspect the raw Git repo and SQLite DB directly inside the project.

### Why we are not supporting project-local state in v0.3

After evaluation, these concerns outweighed the use cases:

1. **Concurrency risk.** SQLite concurrent-write safety in project-local mode is fragile — multiple agents or users writing to the same `.docu-guard/events.sqlite` can cause lock contention or corruption.
2. **Unclear sharing semantics.** If two users share a project via a network filesystem (NFS, SMB), does `.docu-guard/` get shared? If yes, who owns the lock? If no, whose history is authoritative? These questions have no clean answer.
3. **Cloud/team would need a different backend anyway.** For any multi-user or server deployment, project-local state is inadequate — you need daemon-owned storage with proper access control. Supporting both doubles the code surface.
4. **Export/import can solve portability later.** The portable-bundle and air-gapped use cases can be addressed with an explicit export/import mechanism that serializes and restores history, without requiring a live `.docu-guard/` directory in every project.
5. **Simpler daemon and web UI architecture.** A single storage model means one code path for path resolution, validation, migration, and backup.
6. **Simpler Docker/VPS deployment.** Configurable config/data directories map directly to volume mounts. No special handling for `.docu-guard/` inside project workspaces.

**Conclusion:** The project-local mode is not eliminated because it is bad — it is eliminated because the complexity of supporting it as a first-class citizen is not justified for the v0.3 architecture. Portability can be solved later with export/import.

### Option B: Managed storage with configurable directories (recommended)

```
# Project files (always project-local, committed)
/project/docs/
/project/AGENTS.md
/project/.docs-policy.yml

# Managed state (configurable, daemon-owned)
<configDir>/projects.json
<dataDir>/projects/<projectId>/repo.git
<dataDir>/projects/<projectId>/events.sqlite
```

Where `configDir` and `dataDir` are configurable per deployment:

| Environment | `configDir` | `dataDir` |
|-------------|-------------|-----------|
| Local desktop | `~/.config/docu-guard/` | `~/.local/share/docu-guard/` |
| VPS/server | `/etc/docu-guard/` | `/var/lib/docu-guard/` |
| Docker | `/etc/docu-guard/` (volume) | `/var/lib/docu-guard/` (volume) |

**Pros:**
- Single code path for all deployments.
- Daemon manages all state from one directory tree.
- Web UI reads from one location.
- Configurable paths map naturally to Docker volumes and server conventions.
- Centralized backup — one directory to include.
- No `.docu-guard/` clutter in projects.
- Clean separation of concerns: project holds docs, daemon holds state.

**Cons:**
- Breaking change for existing v0.1/v0.2 users (must migrate `.docu-guard/`).
- No portable project-with-history bundle (until export/import is built).
- New contributors must run `docu-guard init` to register the project.
- More complex CLI (needs `--config-dir`, `--data-dir` flags).

---

## Recommended Model

**Option B — Managed storage with configurable directories** is recommended.

### Default behavior (v0.3+)

`docu-guard init` (without flags) creates:

| Location | Content | Committed? |
|----------|---------|------------|
| `/project/docs/` | Documentation directory | ✅ Yes |
| `/project/AGENTS.md` | Agent safety rules | ✅ Yes |
| `/project/.docs-policy.yml` | Policy configuration | ✅ Yes |
| `<dataDir>/projects/<projectId>/repo.git` | Git bare repo (history) | ❌ No (daemon-owned) |
| `<dataDir>/projects/<projectId>/events.sqlite` | Event/proposal database | ❌ No (daemon-owned) |

No `.docu-guard/` directory is created anywhere in the project working tree.

### Desktop defaults

```
configDir: ~/.config/docu-guard/
dataDir:   ~/.local/share/docu-guard/
```

Example daemon invocation:

```bash
docu-guard daemon \
  --host 127.0.0.1 \
  --port 3737 \
  --config-dir ~/.config/docu-guard \
  --data-dir ~/.local/share/docu-guard
```

### Server/VPS defaults

```
configDir: /etc/docu-guard/
dataDir:   /var/lib/docu-guard/
```

Example daemon invocation:

```bash
docu-guard daemon \
  --host 127.0.0.1 \
  --port 3737 \
  --config-dir /etc/docu-guard \
  --data-dir /var/lib/docu-guard
```

### Docker/container model

```
Config volume:  /etc/docu-guard/
Data volume:    /var/lib/docu-guard/
Workspaces:     /workspaces/<projectId>/
```

Example Docker command:

```bash
docker run --rm \
  -p 127.0.0.1:3737:3737 \
  -v docu-guard-config:/etc/docu-guard \
  -v docu-guard-data:/var/lib/docu-guard \
  -v /home/jason/projects:/workspaces \
  docu-guard-mcp:local \
  docu-guard daemon \
    --host 0.0.0.0 \
    --port 3737 \
    --config-dir /etc/docu-guard \
    --data-dir /var/lib/docu-guard
```

### Security note on binding

- Local desktop should bind to `127.0.0.1` by default.
- Docker may bind internally to `0.0.0.0`, but host publishing should bind to `127.0.0.1` unless authentication, TLS, or reverse-proxy protection is added.
- Remote VPS exposure should not be considered safe until authentication and TLS/reverse-proxy guidance exist.

---

## What Stays in the Project

These files remain in the project directory and should be committed to version control:

| File | Purpose | Why in project |
|------|---------|----------------|
| `docs/` | Documentation content | Users expect docs alongside code |
| `AGENTS.md` | Agent safety rules | Agents read this at workspace root |
| `.docs-policy.yml` | Policy configuration | Defines per-project policy rules |

These are the files that the MCP tools protect and manage. They are the user-facing artifacts of docu-guard-mcp.

---

## What Moves to Managed (Daemon-Owned) Storage

These files move from project-local `.docu-guard/` to `<dataDir>/projects/<projectId>/`:

| Current Location | New Location | Content |
|-----------------|--------------|---------|
| `.docu-guard/repo.git` | `<dataDir>/projects/<projectId>/repo.git` | Git bare repository |
| `.docu-guard/events.sqlite` | `<dataDir>/projects/<projectId>/events.sqlite` | Event/proposal database |

The project registry moves to `<configDir>/projects.json`:

| Current Location | New Location |
|-----------------|--------------|
| `~/.config/docu-guard/projects.json` | `<configDir>/projects.json` |

**Rationale for splitting config and data:**

- `configDir` is for small, user-editable configuration files (the registry, project settings).
- `dataDir` is for potentially large, machine-generated, non-user-editable data (Git repos, SQLite databases).
- This follows the XDG Base Directory specification (`XDG_CONFIG_HOME` vs `XDG_DATA_HOME`) and the Filesystem Hierarchy Standard (`/etc/` vs `/var/lib/`) for server deployments.

---

## CLI Changes

### New flags for `daemon` and `server`

```
docu-guard daemon --config-dir <path> --data-dir <path> [--host <host>] [--port <port>]
docu-guard server --config-dir <path> --data-dir <path> --project-id <id> --project-root <path>
```

### `docu-guard init`

```
docu-guard init --project-root <path> [--project-id <id>] [--config-dir <path>] [--data-dir <path>]
```

- `init` creates project files (`docs/`, `AGENTS.md`, `.docs-policy.yml`) in the project root.
- `init` registers the project in `<configDir>/projects.json`.
- `init` does **not** create any `.docu-guard/` directory.
- If `--config-dir` and `--data-dir` are omitted, they default to desktop paths (`~/.config/docu-guard/` and `~/.local/share/docu-guard/`).

### `docu-guard list`, `history`, `export`

These commands continue to work as before. They derive storage paths from the registry entry, which records `configDir` and `dataDir` (or falls back to defaults).

### Registry schema changes

The registry `projects.json` schema is updated for v0.3:

```json
{
  "version": 2,
  "defaultProjectId": "my-app",
  "configDir": "/home/jason/.config/docu-guard",
  "dataDir": "/home/jason/.local/share/docu-guard",
  "projects": {
    "my-app": {
      "projectId": "my-app",
      "projectRoot": "/home/jason/projects/my-app",
      "createdAt": "2026-05-30T10:00:00.000Z",
      "updatedAt": "2026-05-30T10:00:00.000Z"
    }
  }
}
```

Key changes from v1:
- Schema version bumped from 1 to 2.
- `configDir` and `dataDir` at the top level record the paths used at registration time.
- No `storeType` field — there is only one storage model.
- Individual project entries do not need storage paths; they are derived as `<dataDir>/projects/<projectId>/`.

For backward compatibility:
- If `configDir` or `dataDir` is missing, fall back to XDG defaults.
- v1 schema (no version field, no configDir/dataDir) is loaded and upgraded on write.

---

## Handling Existing `.docu-guard/` Directories

Existing v0.1/v0.2 projects have a `.docu-guard/` directory with `repo.git` and `events.sqlite`. These are **pre-v0.3 development artifacts**.

During v0.3 implementation:

1. `docu-guard init` on a project that already has a `.docu-guard/` directory should warn and suggest migration.
2. A one-time migration helper (script or built-in command) copies `.docu-guard/repo.git` → `<dataDir>/projects/<projectId>/repo.git` and `.docu-guard/events.sqlite` → `<dataDir>/projects/<projectId>/events.sqlite`, then removes `.docu-guard/`.
3. The daemon and tools should **not** auto-detect or fall back to `.docu-guard/`. If the managed store is missing, the error should clearly indicate that migration is needed.

---

## Impact on Existing v0.2 Behavior

| Area | Impact |
|------|--------|
| Stdio mode | Needs `--config-dir` / `--data-dir` flags; or environment variables; or defaults |
| Daemon mode | Needs `--config-dir` / `--data-dir` flags (breaking: no auto-detect of `.docu-guard/`) |
| Project registry | Schema version bump (v1 → v2), backward compatible load |
| CLI commands | `init` no longer creates `.docu-guard/`; new flags for daemon |
| MCP tools | No interface changes — tools continue to accept `projectId`, `path`, `branch` etc. |
| `.gitignore` | `.docu-guard/` entry can be removed since it no longer exists in new projects |
| Existing `.docu-guard/` | Must be migrated — not auto-detected or supported as a runtime mode |

**This is a breaking change for anyone with a `.docu-guard/` directory.** Existing users must migrate. The migration is a one-time file copy.

---

## Impact on Daemon Mode

The daemon is the primary consumer of the new storage model:

- All managed state lives under `<dataDir>/projects/`.
- The daemon reads `<configDir>/projects.json` to discover projects.
- No project scanning or `.docu-guard/` detection needed.
- The daemon is configured with `--config-dir` and `--data-dir` at startup.
- Multiple daemon instances on the same machine would need separate config/data directories (or share them with appropriate locking).

---

## Impact on Future Web UI

A centralized global store simplifies the web UI architecture:

- **Single data source:** Web UI reads from `<dataDir>/projects/`.
- **Project discovery:** List directories in `<dataDir>/projects/`.
- **History browsing:** Read Git repos from `<dataDir>/projects/<projectId>/repo.git`.
- **Event log queries:** Read SQLite DBs from `<dataDir>/projects/<projectId>/events.sqlite`.
- **No need to scan user filesystem:** The registry + global store provide everything.
- **Server deployment:** The web UI can run alongside the daemon on a VPS, sharing the same config/data directories.
- **Docker deployment:** The web UI can be in a separate container sharing the data volume.

For the web UI to access managed state:
- It can either embed the docu-guard library (Node.js) and read the store directly.
- Or it can proxy requests through the daemon's MCP endpoint.
- Or both: direct read for queries, daemon proxy for mutations.

---

## Impact on VPS Deployments

Running docu-guard-mcp on a VPS/server:

- Config at `/etc/docu-guard/`, data at `/var/lib/docu-guard/`.
- Daemon binds to `127.0.0.1` and sits behind a reverse proxy (nginx, Caddy) for TLS and authentication.
- Project workspaces are mounted or cloned to a server path, e.g., `/srv/projects/<projectId>/`.
- The daemon manages all projects centrally.
- Backup: include `/etc/docu-guard/` and `/var/lib/docu-guard/` in the backup strategy.
- Multi-PC access is not natively supported — each daemon instance has its own config/data directories. Syncing between machines is a future enhancement.

---

## Impact on Docker/Container Deployments

Running docu-guard-mcp in Docker:

### Container layout

```
/etc/docu-guard/          ← config volume (projects.json)
/var/lib/docu-guard/      ← data volume (repo.git, events.sqlite)
/workspaces/<projectId>/  ← mounted project workspaces
```

### Configuration

- Config volume is mounted read-write for registry updates.
- Data volume is mounted read-write for managed state.
- Project workspaces are mounted read-only or read-write (for `docs/`, `AGENTS.md`, etc.).
- The daemon binds to `0.0.0.0` inside the container; the host publish mapping restricts external access.

### Example

```bash
docker run --rm \
  -p 127.0.0.1:3737:3737 \
  -v docu-guard-config:/etc/docu-guard \
  -v docu-guard-data:/var/lib/docu-guard \
  -v /home/jason/projects:/workspaces \
  docu-guard-mcp:local \
  docu-guard daemon \
    --host 0.0.0.0 \
    --port 3737 \
    --config-dir /etc/docu-guard \
    --data-dir /var/lib/docu-guard
```

### Multi-container considerations

- Multiple docu-guard containers should not share the same config/data volumes without a coordination mechanism.
- Each container instance should have its own volume or use a shared volume with file-level locking.

---

## Impact on Cloud Backup

With managed state centralized:

| Environment | What to back up |
|-------------|-----------------|
| Local desktop | `~/.config/docu-guard/` (config) + `~/.local/share/docu-guard/` (data) |
| VPS/server | `/etc/docu-guard/` + `/var/lib/docu-guard/` |
| Docker | Named volumes `docu-guard-config` and `docu-guard-data` |

**Advantages over v0.2:**
- Single data root to include in backup config, not scattered `.docu-guard/` directories.
- Project clones on a new machine don't need extra steps — just restore the config/data backup.
- CI/CD pipelines can persist a data volume between runs for history continuity.

---

## Security and Privacy Considerations

1. **Managed store location.** Both `~/.local/share/docu-guard/` and `/var/lib/docu-guard/` follow their respective platform conventions for application data. Permissions are inherited from the parent directory.

2. **Cross-project isolation.** Each project's store is in a separate subdirectory under `<dataDir>/projects/`. Standard filesystem permissions apply.

3. **Sensitive content.** Documentation files remain in the project directory — they are not duplicated to the managed store. The managed store contains only Git objects and event logs, which may include sensitive content if users commit sensitive docs. Users should apply appropriate filesystem permissions.

4. **Daemon access control.** The daemon binds to `127.0.0.1` by default (localhost only). Remote exposure requires explicit configuration and should include authentication and TLS.

5. **Docker security.** Inside Docker, the daemon may bind to `0.0.0.0`, but the `-p` flag on the host restricts external access. Users should always pin the host binding to `127.0.0.1` unless a reverse proxy or authentication layer is in place.

6. **Backup considerations.** Users should include both config and data directories in their backup strategy. The config directory is small and changes infrequently; the data directory grows with project history.

---

## Test Plan

### New tests needed

| Test Area | Tests | Description |
|-----------|-------|-------------|
| Configurable config/data dirs | 3-4 | Daemon uses `--config-dir` and `--data-dir`; defaults to XDG paths; rejects invalid paths |
| Init with managed store | 3-4 | `init` creates project files, registers project, creates store in correct location |
| Registry schema v2 | 4-5 | Version bump, configDir/dataDir fields, backward-compatible load of v1 registry |
| Existing `.docu-guard/` detection | 2-3 | Warn on init; error on use; migration helper works |
| Path resolution | 3-4 | Data path derivation from project ID; config path fallback chain |
| Docker/VPS path handling | 2-3 | `/etc/docu-guard/` and `/var/lib/docu-guard/` paths work correctly |
| Daemon with custom paths | 3-4 | Daemon reads/writes managed state to non-default locations |

### Tests removed from previous plan

- `--store global|project` flag tests — no longer applicable.
- Project-local `.docu-guard/` init tests — no longer applicable.
- Mixed-mode daemon tests — only one mode exists.
- Migrate command tests — deferred until migration implementation.

### Existing tests

All 55 v0.1 + v0.2 tests must continue to pass after refactoring. The `Project` class must resolve paths using configurable directories rather than `.docu-guard/`.

---

## Recommendation

**Adopt the managed-storage-with-configurable-directories model (Option B).**

Remove project-local `.docu-guard/` as a first-class storage mode. Existing `.docu-guard/` directories are pre-v0.3 development artifacts that must be migrated.

### Rationale

1. **Single code path, all deployments.** Configurable `--config-dir` and `--data-dir` flags work identically on desktop, VPS, and Docker. No branching on project-local vs global.

2. **Daemon is the primary runtime.** v0.2 introduced the daemon for multi-project management. A centralized store with configurable paths aligns perfectly with daemon architecture.

3. **Web UI needs a single source of truth.** v0.3's web UI will be simpler to build when all managed state lives under one root.

4. **Docker/VPS deployment is clean.** Volume mounts map directly to `--config-dir` and `--data-dir`. No special handling for `.docu-guard/` inside project workspaces.

5. **Backup is centralized.** One config directory and one data directory to include in backup — not a `.docu-guard/` per project.

6. **Complexity removed.** No `--store` flag, no `storeType` field, no auto-detection logic, no dual code paths for path resolution. The `Project` class uses a single path derivation formula.

7. **Portability not sacrificed, deferred.** Export/import will solve portable bundles and air-gapped handoff later, without the complexity of a live `.docu-guard/` directory.

### What we lose

- No more "git clone → history is available immediately" workflow.
- No more ability to inspect the raw Git repo inside the project.
- Breaking change for pre-v0.3 users (one-time migration).
- No easy way to move history between machines without export/import.

These trade-offs are acceptable because:
- `docu-guard init` (to register the project) is a one-time step after clone.
- Inspection is still possible at the data directory path.
- Migration is a one-time file copy.
- Export/import can be added later.

### Implementation order

1. Update `Project` class to accept `configDir` and `dataDir` instead of hard-coding `.docu-guard/`.
2. Update `Registry` schema to v2 with `configDir`/`dataDir` at top level; backward-compatible v1 load.
3. Add `--config-dir` and `--data-dir` flags to `daemon`, `server`, and `init` commands.
4. Remove `.docu-guard/` creation and detection logic.
5. Add migration helper or script for existing `.docu-guard/` directories.
6. Update documentation.
7. Update tests.
8. Dogfood.

---

## Summary of Key Decisions

| Decision | Choice |
|----------|--------|
| Storage model | Managed (daemon-owned) with configurable config/data dirs |
| Project-local `.docu-guard/` | **Removed** — not supported as a first-class mode |
| Local desktop config dir | `~/.config/docu-guard/` (default) |
| Local desktop data dir | `~/.local/share/docu-guard/` (default) |
| Server/VPS config dir | `/etc/docu-guard/` |
| Server/VPS data dir | `/var/lib/docu-guard/` |
| Per-project managed state | `<dataDir>/projects/<projectId>/repo.git` + `events.sqlite` |
| Project registry | `<configDir>/projects.json` |
| Registry schema | v2 with `configDir` and `dataDir` at top level |
| Daemon flags | `--config-dir`, `--data-dir`, `--host`, `--port` |
| Init creates | Project files only: `docs/`, `AGENTS.md`, `.docs-policy.yml` |
| Existing `.docu-guard/` | Pre-v0.3 artifact — must be migrated |
| Project files location | Unchanged — `docs/`, `AGENTS.md`, `.docs-policy.yml` |
| Portability | Deferred to export/import mechanism (future) |
| Backward compatibility | Schema v1 loaded and upgraded; `.docu-guard/` migration needed |
