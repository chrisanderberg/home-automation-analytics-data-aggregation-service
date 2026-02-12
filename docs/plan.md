# plan.md — Aggregation Service Only (Bun + Hono + SQLite)

This plan implements the **Aggregation Layer** only (per `spec.md`):
- ingestion for holding intervals and user-initiated transitions
- time bucketing across **five clocks in parallel**
- dense blob storage with deterministic index math
- UTC quarter window partitioning
- consistent SQLite snapshot export for offline analysis

Notebook/analytics code is intentionally out of scope for this plan and will live
in a separate repo with its own plan.

---

## Scope

### In scope
- Backend service (TypeScript):
  - Runtime: Bun
  - Web framework: Hono
  - Persistence: SQLite (Bun native driver)
  - Validation: Zod
  - Dense blob layout exactly as `spec.md`
  - Five clocks computed in parallel:
    - UTC, Local, Mean solar, Apparent solar, Unequal hours
  - Location + timezone config
  - Snapshot/export endpoint producing consistent SQLite snapshot files

### Out of scope (explicit)
- Any notebook/Jupyter code or analytics algorithms (KDE/CTMC)
- Any dashboard/control UI
- Production deployment/security/auth (local-only assumptions)

---

## Fixed conventions (project-level)

### Time representation
- API uses **UTC Unix epoch milliseconds** as integers:
  - `timestampMs`, `startTimeMs`, `endTimeMs`
- Holding intervals use **half-open semantics**: \([startTimeMs, endTimeMs)\)

### Time-of-week indexing
- 5-minute buckets: 288/day, 2016/week
- Day index convention: **Monday = 0**, …, Sunday = 6
- `bucketOfDay = hour * 12 + floor(minute / 5)`
- `bucketIndex = dayIndex * 288 + bucketOfDay` (0..2015)

### Quarter windows (`spec.md`)
- UTC calendar quarters Q1–Q4 (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec)
- Use:
  - `quarterIndex = (utcYear - 1970) * 4 + (quarterNumber - 1)`

### Dense blob layout (`spec.md` canonical)
Constants:
- `B = 2016` buckets/week
- `C = 5` clocks
- `G = B * C = 10080` values per “bucket group”
- `N = numStates` (2..10; slider typically 6)

Clock ordering (within each group of 10080):
0) UTC
1) Local
2) Mean solar
3) Apparent solar
4) Unequal hours

Blob contains:
1) Holding times (ms), grouped by state: `N * G` values
2) Transition counts, grouped by `(from,to)` excluding diagonal: `N*(N-1)*G` values
Total stored values: `N^2 * G`

Canonical indices (zero-based):
- `holdIndex(s,c,b) = (s*G) + (c*B) + b`
- `transIndex(from,to,c,b) = (N*G) + (transGroupIndex(from,to)*G) + (c*B) + b`
- `transGroupIndex(from,to) = from*(N-1) + offsetWithinFromBlock(from,to)`
  - `offsetWithinFromBlock(from,to) = (to < from) ? to : (to - 1)`

### Blob numeric encoding (service decision)
- All values are **unsigned integers** (holding times: elapsed milliseconds;
  transition counts: increment-by-one counts).
- Use each system’s native representation:
  - **JavaScript**: native `number` for in-memory values.
  - **SQLite BLOB**: store values using the storage/driver’s native integer
    representation (e.g. 64-bit integer if that is the convention for the
    SQLite driver in use). No need to mandate a specific bit width or byte
    order; follow what is natural for the stack.

### Data integrity posture (`spec.md`)
If integrity fails, **discard** the affected data (HTTP 400 + log reason).
Do not invent missing metadata. Do not partially ingest except for skipping a
clock only when that clock’s time mapping is undefined per `spec.md`.

---

## Libraries / runtime

- Runtime: Bun
- Web: Hono
- DB: SQLite via **bun:sqlite** (Bun native driver). Use **exactly one** SQLite
  connection for all writes and for export. Export is implemented by serializing
  the database to memory and writing to a file, producing a consistent snapshot
  at write time.
- Validation: Zod
- Time zones/DST/calendar: `@js-temporal/polyfill`
  - used to compute Local time in a **configurable IANA timezone**, deterministically
- Solar: `suncalc`
  - used for sunrise/sunset and other solar computations for solar clocks

---

## Cross-cutting quality gates (all milestones)

These checks are required for every milestone change set, even when not repeated
inside individual milestone text:

- Tests pass (`bun test`).
- TypeScript check passes (`bunx tsc --noEmit`).
- Docstrings are updated for changed exported symbols in `src/`.
- If CI/pre-merge has a docstring coverage threshold, the change set must meet
  that threshold before merge.

---

## Configuration (service-level)

Required:
- `TIME_ZONE` (IANA, e.g. `America/Los_Angeles`)
- `LATITUDE_DEG` ([-90, 90])
- `LONGITUDE_DEG` ([-180, 180])

Optional:
- `SQLITE_PATH` (default `data.sqlite`)
- `EXPORTS_DIR` (default `exports`)
- `PORT` (default `8787`)
- `MAX_HOLDING_INTERVAL_MS` (default 14 days) as a bug guardrail

The service should **fail fast** on invalid timezone or invalid lat/lon.

---

## API schemas (concrete)

### `POST /ingest/holding`
Body:
```json
{
  "modelId": "string",
  "controlId": "string",
  "state": 0,
  "startTimeMs": 1735756800000,
  "endTimeMs": 1735757100000
}
```

Rules:
- `endTimeMs > startTimeMs`
- `state` validated against stored `numStates`
- If interval crosses a UTC quarter boundary: split into per-quarter slices and
  update multiple aggregate rows.

Response:
```json
{ "ok": true }
```

### `POST /ingest/transition`
Body:
```json
{
  "modelId": "string",
  "controlId": "string",
  "fromState": 5,
  "toState": 2,
  "timestampMs": 1735756920000
}
```

Rules:
- `fromState !== toState`
- states validated against stored `numStates`
- This implementation assumes upstream sends only countable (user) transitions.

Response:
```json
{ "ok": true }
```

### `PUT /admin/controls/:controlId`
Body:
```json
{
  "controlType": "discrete",
  "numStates": 6,
  "stateLabels": ["DIM", "1", "2", "3", "4", "BRIGHT"]
}
```

Rules:
- `numStates` integer 2..10
- if `controlType === "slider"`, enforce `numStates === 6`
- `stateLabels` optional; if present, length equals `numStates`

Response:
```json
{ "ok": true }
```

### `POST /admin/export-snapshot`
Response:
```json
{ "ok": true, "path": "exports/snapshot-YYYYMMDD-HHMMSSmmm.sqlite" }
```

---

## Milestones

### Milestone 0 — Project skeleton + dense-layout invariants tests (UNCHANGED)
#### Goal
Implement dense index math once, with strong tests.

#### Deliverables
- `src/constants.ts`, `src/indices.ts`
- Tests:
  - blob length = `N^2 * G`
  - holding region = `[0, N*G)`
  - transition region = `[N*G, N^2*G)`
  - transition groups cover all `from != to` exactly once

#### Acceptance criteria
- Tests pass for N=2..10 (and specifically N=6).

#### Edge cases
- N=2, to<from and to>from branches.

---

### Milestone 1 — Service scaffold generation (layout + schema + route stubs)
#### Goal
Generate a compilable scaffold that locks in the API contracts, DB schema, and
dependency choices, while leaving core algorithms as TODOs.

#### Deliverables
1) **SQLite schema file** defining `controls` and `aggregates` tables (plus
   recommended indexes and PRAGMAs).
2) **Dependencies installed**:
   - `@js-temporal/polyfill`, `suncalc`, `zod`, `hono`
3) **Stub implementations** that compile, with explicit `TODO:` markers for:
   - `splitByUtcQuarter()`
   - `UtcClock.splitInterval()`, `LocalClock.splitInterval()`
   - solar clock mapping implementations
   - transactional blob update wrapper (`BEGIN IMMEDIATE` read-modify-write)
   - snapshot export implementation

#### Acceptance criteria (command-level, deterministic)
- Running tests:
  1. `bun test`
     - exits with code 0
     - confirms Milestone 0 tests still pass

- Starting the server:
  1. Ensure env vars exist (example):
     - `TIME_ZONE=America/Los_Angeles`
     - `LATITUDE_DEG=37.7749`
     - `LONGITUDE_DEG=-122.4194`
     - (optional) `SQLITE_PATH=data.sqlite`
     - (optional) `EXPORTS_DIR=exports`
     - (optional) `PORT=8787`
  2. Start:
     - `bun run src/server.ts`
     - process stays running and logs a `server_started` event

- HTTP contract smoke checks (copy-pasteable; expected statuses):
  1. `curl -sS http://localhost:8787/health`
     - HTTP 200
     - JSON contains `{ ok, timeZone, latitudeDeg, longitudeDeg }`

  2. `curl -sS -X PUT http://localhost:8787/admin/controls/test-control \
     -H 'content-type: application/json' \
     -d '{"controlType":"slider","numStates":6,"stateLabels":["0","1","2","3","4","5"]}'`
     - HTTP 200 and `{ "ok": true }`

  3. `curl -sS -X POST http://localhost:8787/ingest/holding \
     -H 'content-type: application/json' \
     -d '{"modelId":"m1","controlId":"test-control","state":0,"startTimeMs":0,"endTimeMs":60000}'`
     - HTTP 200 `{ "ok": true }` OR HTTP 501 `{ "ok": false, "error": "not implemented" }`
     - must not crash the process

  4. `curl -sS -X POST http://localhost:8787/ingest/transition \
     -H 'content-type: application/json' \
     -d '{"modelId":"m1","controlId":"test-control","fromState":0,"toState":1,"timestampMs":0}'`
     - HTTP 200 `{ "ok": true }` OR HTTP 501 `{ "ok": false, "error": "not implemented" }`
     - must not crash the process

  5. `curl -sS -X POST http://localhost:8787/admin/export-snapshot`
     - HTTP 200 `{ "ok": true, "path": "exports/..." }` OR HTTP 501 explicit
     - must not crash the process

#### Non-goals
- Correct bucketing/splitting logic (Milestone 3+)
- Correct solar clock mapping (Milestone 7)
- Correct snapshot export implementation (Milestone 8)

#### Edge cases (must be enforced even in stubs)
- Config validation:
  - invalid `TIME_ZONE` prevents server start (fails fast)
  - invalid lat/lon prevents server start
- Control validation:
  - `controlType=slider` requires `numStates=6`
  - if `stateLabels` present, length must equal `numStates`

---

### Milestone 2 — SQLite operations + transactional blob RMW helper
#### Goal
Make DB access correct and safe: schema applied, CRUD works, blob updates are
atomic (no lost updates).

#### Deliverables
- Schema applied at startup (or via a one-time init command)
- Controls CRUD:
  - upsert control
  - fetch control
- Aggregates operations:
  - `getOrCreateAggregateRow()` that verifies `num_states` consistency
  - `withImmediateTransaction(fn)` helper:
    - `BEGIN IMMEDIATE`
    - run fn
    - `COMMIT` / `ROLLBACK`
  - `updateAggregateBlob()` used only inside a transaction

#### Acceptance criteria
- Concurrency sanity check (local):
  - two rapid ingestions do not lose increments (requires transaction wrapper)

#### Edge cases
- control missing => discard ingestion
- `num_states` mismatch => discard ingestion (integrity failure)

---

### Milestone 3 — UTC + Local clock bucketing and interval splitting (Temporal)
#### Goal
Implement correct time-of-week bucketing and holding-interval splitting for:
- UTC clock
- Local clock in configurable IANA timezone (Temporal)

#### Deliverables
- `UtcClock.bucketAt`, `UtcClock.splitInterval`
- `LocalClock.bucketAt`, `LocalClock.splitInterval`
- Algorithm requirements:
  - split \([start,end)\) into overlapped 5-minute buckets
  - conservation: sum(ms) == end-start
  - Local clock handles DST by virtue of Temporal conversions; labels may repeat/skip

#### Acceptance criteria
- UTC bucketAt goldens (Monday=0):
  - `2026-02-02T00:00:00.000Z` => bucket 0
  - `2026-02-01T23:59:59.999Z` => bucket 2015
  - `2026-02-04T12:34:56.789Z` => bucket 726
- UTC splitInterval goldens (exact ms allocations across boundaries)
- Local DST invariant tests (`America/Los_Angeles`):
  - sum(ms) equals elapsed
  - indices in range 0..2015
  - do NOT require monotonic bucket indices

---

### Milestone 4 — Quarter boundary splitting (UTC) + integration into holding ingestion
#### Goal
Correctly partition holding intervals into UTC quarter windows and update the
correct aggregate rows.

#### Deliverables
- `splitByUtcQuarter(start,end)` implemented correctly
- Holding ingestion uses it and updates multiple quarter rows when required

#### Acceptance criteria
- Golden test:
  - `2026-03-31T23:59:00Z` → `2026-04-01T00:01:00Z` splits into two slices:
    - 60,000 ms in Q1 and 60,000 ms in Q2
- End-to-end DB test:
  - two aggregates rows updated with correct totals

---

### Milestone 5 — Holding ingestion fully implemented (UTC + Local) + dense blob updates
#### Goal
Make holding ingestion correct end-to-end for at least UTC and Local clocks,
updating dense blob holding region.

#### Deliverables
- `POST /ingest/holding`:
  - validates payload (Zod)
  - validates control + state range
  - applies quarter splitting
  - for each slice:
    - for each implemented clock:
      - updates `holdIndex(...)` by elapsed ms per bucket
  - runs updates inside `BEGIN IMMEDIATE` transaction(s)

#### Acceptance criteria
- End-to-end test:
  - create control N=6
  - ingest Monday 00:00–00:10 UTC in state 2
  - UTC clock increments:
    - bucket 0: 300,000 ms
    - bucket 1: 300,000 ms
  - only state 2 holding region changes

#### Edge cases
- end <= start => discard
- holding too long (optional guard) => discard

---

### Milestone 6 — Transition ingestion fully implemented (UTC + Local) + dense blob updates
#### Goal
Make transition ingestion correct end-to-end for at least UTC and Local clocks,
updating dense blob transition region.

#### Deliverables
- `POST /ingest/transition`:
  - validates payload
  - validates control + state ranges
  - rejects diagonal transitions
  - computes quarterIndex from UTC timestamp
  - increments `transIndex(...)` by 1 for each defined clock
  - transactional update (`BEGIN IMMEDIATE` RMW)

#### Acceptance criteria
- End-to-end test:
  - ingest transition at `2026-02-02T00:02:00Z`, 5→2
  - UTC increments `transIndex(5,2,UTC,bucket0)` exactly by 1

---

### Milestone 7 — Solar clocks (SunCalc) implemented + always-compute-five-clocks rule
#### Goal
Implement remaining clocks and ensure ingestion always runs five-clock computation
in parallel, skipping only undefined solar cases.

#### Deliverables
- `MeanSolarClock`, `ApparentSolarClock`, `UnequalHoursClock` implemented using SunCalc
- Undefined handling per `spec.md`:
  - if clock mapping undefined => do not count for that clock
- `createClocks()` returns all five in canonical order and ingestion loops all five

#### Acceptance criteria
- For a normal mid-latitude location/date, all clocks produce valid indices
- For an unequal-hours undefined scenario (e.g., polar day/night), unequal-hours
  produces no counts while other clocks still count

#### Note
Solar precision policy is a parameterized implementation detail; document any
assumptions and keep knobs configurable if needed.

---

### Milestone 8 — Snapshot/export implemented (consistent SQLite snapshot)
#### Goal
Create consistent SQLite snapshot files for offline analysis.

#### Strategy (implementation)
- Use **bun:sqlite**: the service uses a single SQLite connection for all
  ingestion and export. Export is implemented by calling `db.serialize()` to
  produce a full copy of the database in memory, then writing that to
  `exports/snapshot-YYYYMMDD-HHMMSSmmm.sqlite` (UTC timestamp with
  milliseconds). The snapshot is consistent at write
  time. If serialize or write fails, log and return an error; do not silently
  produce partial copies.

#### Deliverables
- `POST /admin/export-snapshot` writes
  `exports/snapshot-YYYYMMDD-HHMMSSmmm.sqlite` using bun:sqlite’s
  `serialize()` and then writing the result to the exports directory.
- Service uses exactly one SQLite connection (all ingestion and export go
  through it).
- Manual copy workflow (scp/copy) is documented in the README.

#### Acceptance criteria
- Snapshot file can be opened while service continues ingesting.
- Snapshot is consistent (no partial writes).

---

### Milestone 9 — Hardening: logging, discard reasons, golden suite
#### Goal
Make correctness robust and failures obvious.

#### Deliverables
- Structured logging for every discard (event name + reason + key fields)
- Expanded tests:
  - dense index math goldens
  - bucket goldens
  - interval splitting goldens
  - quarter splitting goldens
  - end-to-end DB blob assertions

#### Acceptance criteria
- `bun test` passes reliably on any machine (independent of host timezone)

---

## Non-goals (reiterated)
- Notebook/analytics/KDE/CTMC implementation
- UI/dashboard
- Production auth/security/scaling

## TBDs (keep parameterized; do not hardcode policies)
- Solar precision policy (document if needed)
- Any future analytics knobs (KDE bandwidth, damping, evaluation metrics)
