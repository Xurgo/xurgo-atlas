You are building a new TypeScript MCP server called `docs-mcp`.

The purpose of `docs-mcp` is to provide safe, versioned, auditable documentation management for AI-assisted software projects. AI agents must not directly overwrite important project documentation. Instead, they should read docs and propose patches through this MCP server.

The MVP should use:

- TypeScript
- Node.js
- @modelcontextprotocol/sdk
- zod for input validation
- simple-git or Git CLI for Git operations
- better-sqlite3 for event logging
- yaml for `.docs-policy.yml`
- a package CLI named `docs-mcp`

Core requirements:

1. Create a TypeScript package with this structure:

   docs-mcp/
     package.json
     tsconfig.json
     README.md
     src/
       index.ts
       mcp/
         server.ts
         tools.ts
         resources.ts
       core/
         project.ts
         git-store.ts
         policy.ts
         patch.ts
         events.ts
         risk.ts
       cli/
         init.ts

2. Implement a CLI with these commands:

   - docs-mcp init --project-root . --project-id my-project
   - docs-mcp server --project-root .
   - docs-mcp list
   - docs-mcp history <path>
   - docs-mcp export --branch main

3. Implement project initialization.

   `docs-mcp init` should:

   - create `.docs-mcp/`
   - create `.docs-mcp/repo.git`
   - create `.docs-mcp/events.sqlite`
   - create `.docs-policy.yml` if missing
   - create `docs/README.md` if missing
   - create `docs/spec/README.md` if missing
   - create `docs/implementation-checklist.md` if missing
   - create or update `AGENTS.md` with documentation safety rules
   - snapshot initial docs into the Git-backed docs store

4. Use Git as the backing store for documentation history.

   Track at minimum:

   - AGENTS.md
   - docs/**
   - .docs-policy.yml

5. Implement these MCP tools:

   - docs.list
   - docs.read
   - docs.create_branch
   - docs.propose_patch
   - docs.preview_diff
   - docs.commit_patch
   - docs.history
   - docs.restore_file
   - docs.export

6. Do not implement a generic `write_file` tool.

   All changes must go through `docs.propose_patch` and `docs.commit_patch`.

7. Every read should return:

   - projectId
   - path
   - branch
   - revision
   - content

8. Every proposed patch must require:

   - projectId
   - branch
   - path
   - baseRevision
   - patch
   - intent
   - summary

9. `docs.propose_patch` must validate:

   - the path is inside the project
   - the path is tracked documentation
   - the branch exists
   - the baseRevision matches the current file revision on the selected branch
   - the patch applies cleanly
   - the patch does not perform suspicious destructive changes without being marked high risk

10. `docs.commit_patch` must:

   - re-check the base revision
   - apply the patch
   - commit to the selected branch
   - write a row to the SQLite event log
   - return the resulting commit revision

11. Implement `.docs-policy.yml`.

   Default policy:

   protected_paths:
     - AGENTS.md
     - docs/**
     - docs/spec/**
     - docs/implementation-checklist.md
     - docs/architecture.md
     - docs/decisions/**

   write_mode:
     default: propose_patch_only
     protected: approval_required

   forbidden_operations:
     - silent_delete
     - whole_file_replace_without_base_revision
     - overwrite_without_diff
     - delete_protected_doc_without_approval

   required_metadata:
     - intent
     - baseRevision
     - summary

   branching:
     agent_branches: true
     merge_to_main_requires: approval

   risk_rules:
     large_deletion_percent: 25
     whole_file_replacement_requires_approval: true
     heading_removal_requires_approval: true
     protected_file_change_requires_approval: true

12. Implement basic risk detection.

   Mark a patch high risk if:

   - it deletes more than 25% of the file
   - it removes Markdown headings
   - it replaces the entire file
   - it modifies AGENTS.md
   - it modifies .docs-policy.yml
   - it deletes a protected file

13. Implement SQLite event logging.

   Create a `doc_events` table:

   id TEXT PRIMARY KEY
   project_id TEXT NOT NULL
   branch TEXT NOT NULL
   path TEXT NOT NULL
   actor TEXT
   tool_name TEXT NOT NULL
   intent TEXT
   summary TEXT
   base_revision TEXT
   result_revision TEXT
   risk_level TEXT
   diff TEXT
   created_at TEXT NOT NULL

14. Implement MCP resources:

   - docs://project/{projectId}/manifest
   - docs://project/{projectId}/HEAD/{path}
   - docs://project/{projectId}/branch/{branch}/{path}
   - docs://project/{projectId}/history/{path}
   - docs://project/{projectId}/policy

15. Add tests for:

   - project initialization
   - reading docs
   - creating branches
   - proposing a valid patch
   - rejecting a stale baseRevision
   - rejecting path traversal
   - detecting large deletion risk
   - committing a patch
   - writing an event log row
   - restoring a file from history

16. Update README.md with:

   - project purpose
   - installation instructions
   - CLI usage
   - MCP configuration example
   - example agent workflow
   - documentation safety model

Important implementation rules:

- Do not directly overwrite docs without a patch.
- Do not silently delete content.
- Prefer small, testable commits.
- Keep the initial implementation simple.
- Use clear error messages.
- Make the code modular.
- Do not build a web UI in the MVP.
- Do not implement cloud sync in the MVP.

Start by creating the package structure, package.json, tsconfig.json, and the basic CLI. Then implement project initialization and the Git-backed store. After that, implement the MCP server tools one by one.
