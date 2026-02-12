import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { blobLength } from "./constants.js";
import { IntegrityError } from "./errors.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Bytes per blob value (64-bit little-endian). */
export const BLOB_VALUE_BYTES = 8;

/** Open the SQLite database and apply required connection PRAGMAs. */
export function openDb(sqlitePath: string): Database {
  const db = new Database(sqlitePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Apply schema DDL from src/schema.sql to the current database. */
export function applySchema(db: Database): void {
  const schemaPath = join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  db.exec(sql);
}

/**
 * Create or update a control definition.
 * Rejects num_states changes when aggregate rows already exist for the control.
 */
export function upsertControl(
  db: Database,
  controlId: string,
  controlType: "discrete" | "slider",
  numStates: number,
  stateLabels: string[] | null
): void {
  db.run("BEGIN IMMEDIATE");
  try {
    const existing = db
      .query("SELECT num_states FROM controls WHERE control_id = ?")
      .get(controlId) as { num_states: number } | null;
    if (existing !== null && existing.num_states !== numStates) {
      const aggregateExists = db
        .query("SELECT 1 AS present FROM aggregates WHERE control_id = ? LIMIT 1")
        .get(controlId) as { present: number } | null;
      if (aggregateExists !== null) {
        throw new IntegrityError(
          "cannot change num_states for control with existing aggregates"
        );
      }
    }

    const labelsJson = stateLabels === null ? null : JSON.stringify(stateLabels);
    db.run(
      `INSERT INTO controls (control_id, control_type, num_states, state_labels)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (control_id) DO UPDATE SET
         control_type = excluded.control_type,
         num_states = excluded.num_states,
         state_labels = excluded.state_labels`,
      [controlId, controlType, numStates, labelsJson]
    );
    db.run("COMMIT");
  } catch (err) {
    try {
      db.run("ROLLBACK");
    } catch (_) {
      /* ignore rollback errors; rethrow original */
    }
    throw err;
  }
}

/** Load a control definition, validating stored state_labels JSON shape. */
export function getControl(
  db: Database,
  controlId: string
): { controlType: string; numStates: number; stateLabels: string[] | null } | null {
  const row = db
    .query(
      "SELECT control_type, num_states, state_labels FROM controls WHERE control_id = ?"
    )
    .get(controlId) as
    | { control_type: string; num_states: number; state_labels: string | null }
    | undefined;
  if (!row) return null;
  let stateLabels: string[] | null = null;
  if (row.state_labels !== null) {
    try {
      const parsed = JSON.parse(row.state_labels) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        throw new IntegrityError("control state_labels malformed JSON");
      }
      stateLabels = parsed;
    } catch {
      throw new IntegrityError("control state_labels malformed JSON");
    }
  }
  return {
    controlType: row.control_type,
    numStates: row.num_states,
    stateLabels,
  };
}

/**
 * Ensures an aggregate row exists for (controlId, modelId, quarterIndex) and
 * verifies num_states consistency. Call inside a transaction (e.g. inside
 * withImmediateTransaction) so creation and later updateAggregateBlob are atomic.
 * Throws if control is missing or num_states mismatch (discard ingestion).
 */
export function getOrCreateAggregateRow(
  db: Database,
  controlId: string,
  modelId: string,
  quarterIndex: number,
  numStates: number
): void {
  const control = getControl(db, controlId);
  if (!control) {
    throw new IntegrityError("control missing");
  }
  if (control.numStates !== numStates) {
    throw new IntegrityError("num_states mismatch");
  }
  const expectedBytes = blobLength(numStates) * BLOB_VALUE_BYTES;
  const zeroBlob = new Uint8Array(expectedBytes);
  db.run(
    `INSERT INTO aggregates (control_id, model_id, quarter_index, blob)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (control_id, model_id, quarter_index) DO NOTHING`,
    [controlId, modelId, quarterIndex, zeroBlob]
  );

  const row = db
    .query(
      "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
    )
    .get(controlId, modelId, quarterIndex) as { blob: Uint8Array | null } | null;
  if (row === null) {
    throw new IntegrityError("aggregate row missing");
  }
  if (row.blob === null) {
    throw new IntegrityError("aggregate blob is null");
  }
  if (row.blob.length !== expectedBytes) {
    throw new IntegrityError("aggregate blob length mismatch");
  }
}
