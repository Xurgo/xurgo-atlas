# Agent Instructions for Xurgo Atlas

## Session start

Boot per the corpus-owned sequence in `~/.xurgo/governance/xurgo-ecosystem/AGENTS.md` ("Session start (coordination)"): boot bundle (`python3 corpus-context-bundle.py "<situation>"`; no match → inject nothing, ask) → corpus `STATUS.md` → `templates/base-handoff-v01.md` → `operations/gates-register-v01.md` → `policies/cross-product-coordination-process-v01.md` → (if the task needs the Authority–Studio link) `operations/opencode-coordinator-compatibility-runbook-v01.md` for A4 lease mechanics. Then read THIS file (DYOR, mandatory first read for repo work) and `STATUS.md` for current focus.

The prior pointer here named `standards/fresh-boot-sequence-hub.md`, which was RETIRED 2026-08-14 and moved to `archive/standards/`. The live contract is `templates/base-handoff-v01.md`, which salvages the golden rule and hard gates. Decision `CORPUS_WRITE_PATH_PLAIN_GIT_2026-09-15` authorized fixing this pointer; Studio was corrected and Atlas was not.

## Corpus queries

When searching the governance corpus (`~/.xurgo/governance/xurgo-ecosystem/`), **always use the Python utility scripts**, never raw grep/rg:

- `python3 corpus-query.py "<search terms>"` — full-text search over all corpus markdown
- `python3 corpus-context-bundle.py "<situation>"` — pre-bundled context for a given situation (bounded by `CORPUS_BOOT_CEILING_CHARS = 8000`)

These scripts live in the corpus root. They handle path resolution, result formatting, and budget enforcement. Raw `rg`/`grep` misses formatting, budget constraints, and context-routing logic.

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

8. **Classify managed-doc export drift before commit.** Before commit, inspect all managed-doc/export changes. Do not keep drift just because export produced it. Classify unexpected managed-doc changes as required for this branch, valid managed-store/source synchronization, or unrelated stale drift to revert, and report the classification before commit.

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

## Research before answering

Required before presenting a recommendation, an answer, or an assertion. This
project is a documentation server, so the failure mode is specific: a plausible
description of how a store or a tool behaves, written from memory or from a
comment, and therefore confidently wrong.

1. **Review the corpus first** via `corpus-query.py` / `corpus-context-bundle.py`
   (never raw grep), including the gates register. A prior decision may already
   have settled the question.
2. **Research online from primary sources, and classify what you get.**
   *Primary source* means the authority that owns the fact: the project's own
   spec or reference docs, its source code, its release notes, or an issue or
   advisory on the project's own tracker. For this project that means the MCP
   spec, the store schema in the source, and the vendor's own tracker. A blog,
   tutorial, summary post, or another model's answer is **not** a primary
   source, however authoritative it sounds. The test is provenance, not
   reputation: *can I name the artifact and where it says this?* If not, it is not
   a primary source. A documented control is not evidence that it works — if the
   finding matters, confirm it in the code or a test. Then classify each
   material claim per the corpus standard (evidence classes: directly verified /
   source-grounded / strong inference / unverified possibility / unsupported).
   For load-bearing claims, use the corpus provenance format
   (`research/studio-adaptive-intelligence-research-agenda.md`): claim, evidence
   class, exact supporting source, remaining gap.
3. **Read the code before describing it.** Check the claim against the file, at
   the line. Store semantics, revision handling, and export behaviour are easy
   to describe approximately and wrong exactly.
4. **State what you verified and what you did not**, separately. Do not report a
   test, command, or check that did not run in this session.
5. **Prefer the test that cannot cause harm.** A manual prompt that depends on
   the safeguard being correct is the wrong kind of test when the failure mode
   is a destroyed store or a leaked secret. Assert on parsed arguments; spawn
   nothing.

## Diagnosing an unexplained failure

Applies before proposing a fix for a failure you cannot yet explain. Full
rationale, sources, and measured anti-patterns:
`~/.xurgo/governance/xurgo-ecosystem/operations/diagnostic-discipline-and-repair-assignment-v01.md`.
The short form — establish the observable facts, trace backward to the earliest
unrecovered failure, assign the fault side, pass the evidence test, classify
before retrying, and check the fix belongs to the assigned component. Recency
anchoring and observability that exists but goes unread are the two failure
modes to watch for.

## Completion-return contract

Any session that may hand back to a Coordinator (or be resumed) returns via the corpus-owned five-section completion-return contract: DISPOSITION → REPORT → DECISIVE EVIDENCE → SCOPE-SAFETY → NEXT DECISION. Start from `~/.xurgo/governance/xurgo-ecosystem/templates/default-handoff-preamble-v01.md` (the stable ecosystem context preamble — always prepend), then fill the session-specific content from `~/.xurgo/governance/xurgo-ecosystem/templates/handoff-and-rehydration-bootstrap-v01.md` and `~/.xurgo/governance/xurgo-ecosystem/standards/coordinator-continuity-guide.md`, not a hand-written approximation.
