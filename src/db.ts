import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
