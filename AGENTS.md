# Agent Instructions for Xurgo Atlas

## Documentation Safety Rules

This project uses **Xurgo Atlas** for safe, versioned, auditable documentation management.

### Rules for AI Agents

1. **Never directly overwrite documentation files.** All documentation changes must go through the Xurgo Atlas MCP server.

2. **Read before you write.** Always read the current version of a document before proposing changes.

3. **Use docs.propose_patch to suggest changes.** Every change requires a patch with:
   - `baseRevision` - the revision hash returned when you read the file
   - `intent` - why you are making the change
   - `summary` - a brief description of the change
   - `patch` - the unified diff of your changes

4. **Use docs.commit_patch to finalize.** After proposing a patch, use `docs.commit_patch` to apply it. The server will re-validate the base revision before committing.

5. **Create branches for complex changes.** Use `docs.create_branch` to create feature branches for multi-step edits.

6. **Check risk assessments.** If a patch is marked high-risk, review the warnings before committing.

7. **Never delete content silently.** All deletions must be explicit in the patch diff.

### Code Comment Standards

Keep comments focused on the why, not the obvious mechanics.

- Add comments for non-obvious safety boundaries, invariants, compatibility aliases, failure modes, lifecycle and resource handling, schema intent, and consumer-facing JSON semantics.
- For root/write safety code, document fail-closed versus fail-soft choices and recovery exceptions.
- For SQLite and storage code, document schema purpose, identity keys, lazy creation or migration behavior, resource lifecycle, and fail-soft behavior.
- For public JSON, MCP, and status fields, document whether a field is descriptive, authoritative, compatibility-preserving, or intended for consumers or coordinators.
- Avoid noisy comments that merely restate code.

### Tracked Files

The following active project documents are managed through Xurgo Atlas and must not be edited directly:

- `STATUS.md`
- `AGENTS.md`
- `docs/manifest.yml`
- `.docs-policy.yml`
- documents listed in `docs/manifest.yml` and served through the Atlas `docs.list` / `docs.manifest` view

Historical documentation under `docs/spec/**` may not all appear in the active Atlas manifest. Treat those files as auditable project documentation: prefer Atlas guarded tools when available, avoid stale active instructions, and do not leave personal or local machine path leaks in committed content.

### Quick Reference

| Action | Tool |
|--------|------|
| Read project status | `docs.status` |
| Read project manifest | `docs.manifest` |
| List documentation | `docs.list` |
| Read a document | `docs.read` |
| Read a document section | `docs.read_section` |
| Create a branch | `docs.create_branch` |
| Propose changes | `docs.propose_patch` |
| Preview changes | `docs.preview_diff` |
| Commit changes | `docs.commit_patch` |
| View history | `docs.history` |
| Restore a file | `docs.restore_file` |
| Export documentation | `docs.export` |
