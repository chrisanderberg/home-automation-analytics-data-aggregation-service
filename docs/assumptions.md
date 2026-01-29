# assumptions.md (TypeScript backend + notebook validation + snapshot export)

This is a hobby project intended to run on a local machine or local network. The
primary goal is to start collecting data quickly and validate the analytics
hypothesis and strategy with minimal friction.

## Deployment assumptions

- Local-only deployment (laptop/desktop/home server).
- Development-style run environments are acceptable.
- No production hosting, scaling, or strict security requirements.
- Authentication can be minimal or omitted on trusted local networks.

## Scope and goals (for this implementation)

- Primary scope: **data aggregation + analytics validation**.
- A custom dashboard/control UI is out of scope for the initial phase.
  Existing tools (Home Assistant, Node-RED, etc.) can provide control UIs and act
  as sources of ingestion events.
- Analytics will be validated externally (Jupyter notebook) before being rolled
  into the service.

## Architecture (intended)

### Backend service (TypeScript)
- Runtime: **Bun**
- Web framework: **Hono**
- Database: **SQLite** (Bun native SQLite driver)
- Schema validation: **Zod** (if needed)
- ORM: **Drizzle** (optional; acceptable to use raw SQL where simpler, especially
  for blob updates)

Service responsibilities:
- Provide a small ingestion API for the two fundamental measurement operations
  defined in `spec.md`:
  1) Holding interval ingestion:
     - modelId, controlId, state, startTime, endTime
     - split elapsed milliseconds across overlapped time-of-week buckets for each
       of the five clocks (computed in parallel)
     - increment holding-time aggregates in the dense blob layout
  2) Transition ingestion:
     - modelId, controlId, fromState, toState, timestamp
     - increment transition aggregates in the dense blob layout

Attribution assumption for this implementation:
- The service assumes that **all transitions it receives are intended to be
  counted** (i.e., user-initiated transitions). Upstream systems should not send
  automation-only transitions.

Persistence intent:
- Store control metadata and aggregated sufficient statistics in SQLite.
- Aggregated data follows the dense blob/index math described in `spec.md` (no
  map/sparse bucket storage in core aggregation).

### Analytics validation (external notebook)
- Use a Jupyter notebook (Python) to:
  - read aggregated blobs from a SQLite snapshot,
  - experiment with KDE smoothing and sparse-data handling options,
  - construct CTMCs and compute stationary distributions,
  - validate the core hypothesis (per-model convergence) and compare clocks.

Notebook location assumption:
- The notebook may run on a different machine than the service.

### Snapshot/export workflow (initially manual)
- The service should support producing a consistent SQLite snapshot file for
  offline analysis.
- Initial workflow is manual copy (e.g., SCP) from the service machine to the
  analysis machine.
- The notebook reads from the snapshot file, not the live database, to avoid
  concurrency issues and to ensure reproducibility.

## Later stage (optional, not required now)

Once the analytics strategy is validated in notebooks:
- Roll analytics into the backend service as query endpoints.
- Hono can optionally render simple JSX pages for basic visualization of results
  (lightweight UI), but this is explicitly deferred until analytics are proven.

## Repository structure preference

- A single repository is acceptable even with TypeScript + Python, but the
  service and notebook tooling should remain loosely coupled.
- Suggested top-level components:
  - backend service (Bun + Hono)
  - notebooks/ for analysis validation
  - exports/ (gitignored) for SQLite snapshots
  - docs/ (`spec.md` and implementation plans)

## Non-goals (for this implementation)

- Full dashboard/control UI, realtime client syncing, or complex frontend work.
- Production deployment workflows, CI/CD, multi-tenant auth.
- Formal orchestration tooling (Dagster) unless needed later.

## Notes for planning

- The implementation plan should optimize for:
  - quick ingestion of holding intervals and transitions,
  - correct time bucketing across five clocks,
  - dense blob storage with deterministic index math,
  - easy snapshot export and notebook-driven validation.
- KDE bandwidth and sparse-data damping strategy remain TBD and should stay
  parameterized.