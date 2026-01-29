import { Hono } from "hono";
import { z } from "zod";
import { UtcClock, LocalClock } from "./clocks.js";
import { loadConfig } from "./config.js";
import {
  openDb,
  applySchema,
  upsertControl,
  getControl,
  getOrCreateAggregateRow,
} from "./db.js";
import { exportSnapshot } from "./export.js";
import {
  withImmediateTransaction,
  updateAggregateBlob,
  getBlobValue,
  setBlobValue,
} from "./blob.js";
import { holdIndex } from "./indices.js";
import { splitByUtcQuarter } from "./quarters.js";

const putControlBody = z.object({
  controlType: z.enum(["discrete", "slider"]),
  numStates: z.number().int().min(2).max(10),
  stateLabels: z.array(z.string()).optional(),
});

const postHoldingBody = z.object({
  modelId: z.string(),
  controlId: z.string(),
  state: z.number().int().min(0),
  startTimeMs: z.number().int(),
  endTimeMs: z.number().int(),
});

const postTransitionBody = z.object({
  modelId: z.string(),
  controlId: z.string(),
  fromState: z.number().int().min(0),
  toState: z.number().int().min(0),
  timestampMs: z.number().int(),
});

function main() {
  let config;
  try {
    config = loadConfig(process.env as Record<string, string | undefined>);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const db = openDb(config.sqlitePath);
  applySchema(db);

  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({
      ok: true,
      timeZone: config.timeZone,
      latitudeDeg: config.latitudeDeg,
      longitudeDeg: config.longitudeDeg,
    });
  });

  app.put("/admin/controls/:controlId", async (c) => {
    const controlId = c.req.param("controlId");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = putControlBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation failed" }, 400);
    }
    const { controlType, numStates, stateLabels } = parsed.data;
    if (controlType === "slider" && numStates !== 6) {
      return c.json(
        { ok: false, error: "slider requires numStates === 6" },
        400
      );
    }
    if (stateLabels !== undefined && stateLabels.length !== numStates) {
      return c.json(
        { ok: false, error: "stateLabels length must equal numStates" },
        400
      );
    }
    upsertControl(db, controlId, controlType, numStates, stateLabels ?? null);
    return c.json({ ok: true });
  });

  app.post("/ingest/holding", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = postHoldingBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation failed" }, 400);
    }
    const { modelId, controlId, state, startTimeMs, endTimeMs } = parsed.data;
    if (endTimeMs <= startTimeMs) {
      return c.json({ ok: false, error: "endTimeMs must be > startTimeMs" }, 400);
    }
    const control = getControl(db, controlId);
    if (!control) {
      return c.json({ ok: false, error: "control missing" }, 400);
    }
    if (state >= control.numStates) {
      return c.json({ ok: false, error: "state out of range" }, 400);
    }
    const numStates = control.numStates;
    const slices = splitByUtcQuarter(startTimeMs, endTimeMs);
    try {
      await withImmediateTransaction(db, () => {
        for (const slice of slices) {
          getOrCreateAggregateRow(
            db,
            controlId,
            modelId,
            slice.quarterIndex,
            numStates
          );
          updateAggregateBlob(
            db,
            controlId,
            modelId,
            slice.quarterIndex,
            numStates,
            (dv) => {
              const utcSlices = UtcClock.splitInterval(
                slice.startTimeMs,
                slice.endTimeMs
              );
              for (const bs of utcSlices) {
                const idx = holdIndex(state, 0, bs.bucketIndex);
                const prev = getBlobValue(dv, idx);
                setBlobValue(
                  dv,
                  idx,
                  prev + (bs.endTimeMs - bs.startTimeMs)
                );
              }
              const localSlices = LocalClock.splitInterval(
                slice.startTimeMs,
                slice.endTimeMs,
                config.timeZone
              );
              for (const bs of localSlices) {
                const idx = holdIndex(state, 1, bs.bucketIndex);
                const prev = getBlobValue(dv, idx);
                setBlobValue(
                  dv,
                  idx,
                  prev + (bs.endTimeMs - bs.startTimeMs)
                );
              }
            }
          );
        }
      });
      return c.json({ ok: true });
    } catch (e) {
      return c.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : "ingestion failed",
        },
        400
      );
    }
  });

  app.post("/ingest/transition", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = postTransitionBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation failed" }, 400);
    }
    const { fromState, toState } = parsed.data;
    if (fromState === toState) {
      return c.json(
        { ok: false, error: "fromState must not equal toState" },
        400
      );
    }
    // TODO: real ingestion (Milestone 6); return 501 until implemented
    return c.json({ ok: false, error: "not implemented" }, 501);
  });

  app.post("/admin/export-snapshot", async (c) => {
    try {
      const path = await exportSnapshot(db, config.exportsDir);
      return c.json({ ok: true, path });
    } catch {
      return c.json({ ok: false, error: "not implemented" }, 501);
    }
  });

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  console.log(
    JSON.stringify({
      event: "server_started",
      port: server.port,
      timeZone: config.timeZone,
    })
  );
}

main();
