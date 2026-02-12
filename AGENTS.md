# AGENTS.md

This repo is implemented using coding agents (Cursor, Claude Code, OpenCode).
Follow these rules to keep the implementation correct, consistent, and aligned
with the project’s documentation.

## Source of truth and authority order

1) `docs/spec.md` — source of truth for definitions, invariants, and semantics  
2) `docs/plan.md` — step-by-step milestones for this repo (must conform to spec)  
3) `docs/assumptions.md` — project constraints/preferences (spec wins on conflict)

If a code change would conflict with `docs/spec.md`, stop and update `docs/spec.md`
first (or explicitly mark the point as TBD in `docs/spec.md`) before implementing.

## How to work (milestone-driven)

- Implement **exactly one milestone at a time** from `docs/plan.md`.
- Do not start future milestones unless explicitly requested.
- Each milestone must include:
  - required code changes
  - required tests
  - required commands to verify
- Keep TBD items parameterized/configurable. Do not guess policies.

## Scope guardrails

This repo implements the **Aggregation Layer only**.

Do NOT implement:
- notebook/Jupyter code
- KDE / CTMC / stationary distribution analytics
- dashboards/control UIs
- authentication/production deployment features

Do implement:
- ingestion of holding intervals and transitions
- time bucketing across five clocks in parallel
- dense blob storage with deterministic index math
- UTC calendar quarter windowing
- SQLite snapshot export for offline analysis

## Core invariants to enforce in code

From `docs/spec.md` and `docs/plan.md`:

- Five clocks are always computed in parallel and stored in canonical order:
  0) UTC, 1) Local, 2) Mean solar, 3) Apparent solar, 4) Unequal hours
- Time-of-week buckets are always 2016/week, 5-minute buckets.
- Day-of-week indexing: Monday = 0, ..., Sunday = 6.
- Holding intervals are half-open: [startTimeMs, endTimeMs).
- Holding time is split across all overlapped buckets per clock.
- Transitions counted are only those intended to be counted (this implementation
  assumes upstream only sends user transitions).
- Quarter windows are UTC calendar quarters (Q1–Q4) and may be represented by a
  computed `quarterIndex`.
- Dense blob layout and index math are canonical; do not replace with map/sparse
  representations.
- Blob values are unsigned integers; use native representation per system
  (JavaScript: number; SQLite BLOB: native integer, e.g. 64-bit).

## Data structures and performance guidance

- Do not store bucketed data in `Map`/`Record` keyed by bucket IDs in hot paths.
  The aggregated data model is dense and positional; missing data means zero.
- Implement a small abstraction around the blob:
  - allocate/validate blob length (N^2 * G)
  - read/write unsigned integer values at computed indices
  - expose helpers for `holdIndex(...)` and `transIndex(...)`
- Keep math deterministic and testable without the database (pure functions where
  possible).

## Database safety (SQLite)

- All blob updates must be done as an atomic read-modify-write under a transaction.
  Use `BEGIN IMMEDIATE` for ingestion updates to avoid lost updates.
- If integrity checks fail (invalid timestamps, invalid states, missing control,
  numStates mismatch, etc.), discard the request:
  - return HTTP 400
  - log a structured reason

## Snapshot/export

- Export creates a consistent SQLite snapshot file in `exports/` (gitignored).
- Use `bun:sqlite` `Database.serialize()` to produce a consistent snapshot byte
  image, then write it to a file in `exports/` (see `src/export.ts`).
- Service uses exactly one SQLite connection so snapshots can be taken while
  ingesting.
- Initial workflow is manual copy/SCP; do not build network transfer features.

## Testing requirements

- Prefer unit tests for:
  - index math (coverage for N=2..10)
  - bucket indexing (Monday=0, range constraints)
  - interval splitting conservation: sum(ms) == end-start
  - quarter splitting across UTC quarter boundaries
- Tests must be deterministic and not depend on the host machine timezone.
- Add end-to-end DB tests where milestones require it (ingest → persisted blob
  assertions).

## Dependency discipline

- Do not add new dependencies unless required by `docs/plan.md` or explicitly
  approved.
- Prefer small, auditable libraries. Keep the dependency surface minimal.

## TypeScript and linting

- **Always** check for TypeScript and lint errors after proposing code changes.
- After editing files, run the project linter (or read linter diagnostics) on the
  files you changed; fix any reported errors before considering the change done.
- Prefer resolving type errors properly (e.g. narrowing, `?? []`, or explicit
  checks) over broad assertions; use non-null assertions (`!`) only where the
  value is guaranteed by invariants (e.g. UTC clock always returns a number).
- Do not leave new type errors or lint issues in the codebase.

## Docstrings and API documentation

- Treat docstring coverage failures as blocking (same as test/lint failures).
- For any changed or added exported symbol in `src/` (`export function`,
  `export class`, exported constants with function values), add or update a
  JSDoc block in the same change.
- If behavior or constraints change, update the docstring text at the same time;
  do not defer documentation updates.
- Before marking work done, run the same docstring coverage check used by CI or
  pre-merge checks. If that command is not available locally, perform a manual
  pass over changed exports and confirm each has JSDoc.
- Any agent final response that includes code changes must explicitly state that
  docstring checks were run (or that a manual export/JSDoc audit was completed).

## Commands (typical)

Use these commands when relevant to verify milestones:

```bash
bun install
bun test
bunx tsc --noEmit
bun run src/server.ts
```

When adding new commands, update `package.json` scripts and document how to run
them in `docs/plan.md` acceptance criteria.

## Expected agent output format (when making changes)

When responding with an implementation:
- list files added/changed
- explain what milestone was implemented
- provide commands to run to verify
- note any assumptions/TBDs surfaced (do not silently decide them)
- confirm conformance with `docs/spec.md` invariants
- confirm that TypeScript and lint checks pass on changed files (see above)
