# Aggregation Service (Bun + Hono + SQLite)

A local-first aggregation service for collecting home-automation control behavior
and producing dense, bucketed sufficient statistics suitable for offline
analytics (e.g., Jupyter notebooks).

This repo implements the **Data Aggregation Layer** only, as defined in
`docs/spec.md`.

## What this service does

- Ingests two kinds of events:
  1) **Holding intervals** (a control stayed in a state over a time window)
  2) **Transitions** (a control changed from one state to another at a timestamp)
- Buckets data by **time-of-week** using **5-minute buckets** (2016 buckets/week),
  computed across **five clocks in parallel**:
  - UTC
  - Local time (configurable IANA timezone)
  - Mean solar time
  - Apparent solar time
  - Unequal hours
- Partitions stored aggregates by **UTC calendar quarters** (Q1–Q4), using a
  computed `quarterIndex`.
- Stores aggregated sufficient statistics in a **dense blob** with deterministic
  index math (no sparse maps for bucket storage).
- Exports **consistent SQLite snapshot files** for offline notebook analysis.
  Initial workflow is manual copy/SCP.

## What this service does NOT do (by design)

- No dashboard / control UI
- No KDE / CTMC / stationary distribution analytics in this repo
- No production auth/security/scaling concerns (local-only assumptions)

Analytics code is expected to live separately (e.g., notebooks that read exported
SQLite snapshots).

## Documentation (source of truth)

- `docs/spec.md` — canonical definitions, invariants, dense blob layout, index math
- `docs/plan.md` — milestone-driven implementation plan for this repo
- `docs/assumptions.md` — project constraints and preferences for this repo

If there is any conflict, **`docs/spec.md` wins**.

## Runtime and dependencies

- Runtime: Bun
- Web framework: Hono
- Database: SQLite (Bun native `bun:sqlite`)
- Validation: Zod
- Timezone/DST/calendar: `@js-temporal/polyfill`
- Solar calculations: `suncalc`

## Configuration

Required environment variables:

- `TIME_ZONE` — IANA timezone (e.g., `America/Los_Angeles`)
- `LATITUDE_DEG` — latitude in degrees ([-90, 90])
- `LONGITUDE_DEG` — longitude in degrees ([-180, 180])

Optional:

- `SQLITE_PATH` — default `data.sqlite`
- `EXPORTS_DIR` — default `exports`
- `PORT` — default `8787`
- `MAX_HOLDING_INTERVAL_MS` — default `14 days` (bug guardrail)

The service should fail fast on invalid timezone or invalid lat/lon.

## Data conventions

- All timestamps are **UTC Unix epoch milliseconds** (integers).
- Holding intervals use **half-open** semantics: \([startTimeMs, endTimeMs)\).
- Transitions in this implementation are assumed to already be filtered upstream:
  **all transitions received are intended to be counted** (i.e., user-initiated).

## API

### `PUT /admin/controls/:controlId`

Upsert control metadata.

Example:

```bash
curl -sS -X PUT http://localhost:8787/admin/controls/test-control \
  -H 'content-type: application/json' \
  -d '{"controlType":"slider","numStates":6,"stateLabels":["0","1","2","3","4","5"]}'
```

### `POST /ingest/holding`

Ingest a holding interval.

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

Example:

```bash
curl -sS -X POST http://localhost:8787/ingest/holding \
  -H 'content-type: application/json' \
  -d '{"modelId":"m1","controlId":"test-control","state":0,"startTimeMs":0,"endTimeMs":60000}'
```

### `POST /ingest/transition`

Ingest a transition (assumed user-initiated for this repo).

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

Example:

```bash
curl -sS -X POST http://localhost:8787/ingest/transition \
  -H 'content-type: application/json' \
  -d '{"modelId":"m1","controlId":"test-control","fromState":0,"toState":1,"timestampMs":0}'
```

### `POST /admin/export-snapshot`

Produce a consistent SQLite snapshot for offline analysis. The snapshot is
created by serializing the database and writing it to a file; the exported file
is consistent at write time. Snapshots are written to `EXPORTS_DIR` (default
`exports/`). The intended workflow is manual copy of the snapshot file (e.g.
`scp` or `cp`) to the analysis machine; the service does not provide network
transfer or auth for exports.

Example:

```bash
curl -sS -X POST http://localhost:8787/admin/export-snapshot
```

Response:

```json
{ "ok": true, "path": "exports/snapshot-YYYYMMDD-HHMMSS.sqlite" }
```

Then copy it to the analysis machine manually, for example:

```bash
scp exports/snapshot-*.sqlite user@analysis-host:/path/to/notebooks/
```

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
```

Run the server (example env vars):

```bash
export TIME_ZONE="America/Los_Angeles"
export LATITUDE_DEG="37.7749"
export LONGITUDE_DEG="-122.4194"
export PORT="8787"

bun run src/server.ts
```

Health check:

```bash
curl -sS http://localhost:8787/health
```

## License

See `LICENSE`.