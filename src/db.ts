import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { blobLength } from "./constants.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Bytes per blob value (64-bit little-endian). */
export const BLOB_VALUE_BYTES = 8;

export function openDb(sqlitePath: string): Database {
  const db = new Database(sqlitePath);
  return db;
}

export function applySchema(db: Database): void {
  const schemaPath = join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  db.exec(sql);
}

export function upsertControl(
  db: Database,
  controlId: string,
  controlType: "discrete" | "slider",
  numStates: number,
  stateLabels: string[] | null
): void {
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
}

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
  const stateLabels =
    row.state_labels === null ? null : (JSON.parse(row.state_labels) as string[]);
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
    throw new Error("control missing");
  }
  if (control.numStates !== numStates) {
    throw new Error("num_states mismatch");
  }
  const expectedBytes = blobLength(numStates) * BLOB_VALUE_BYTES;
  const row = db
    .query(
      "SELECT blob FROM aggregates WHERE control_id = ? AND model_id = ? AND quarter_index = ?"
    )
    .get(controlId, modelId, quarterIndex) as { blob: Uint8Array } | undefined;
  if (row) {
    if (row.blob.length !== expectedBytes) {
      throw new Error("aggregate blob length mismatch");
    }
    return;
  }
  const zeroBlob = new Uint8Array(expectedBytes);
  db.run(
    "INSERT INTO aggregates (control_id, model_id, quarter_index, blob) VALUES (?, ?, ?, ?)",
    [controlId, modelId, quarterIndex, zeroBlob]
  );
}
