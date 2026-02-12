-- Aggregation service schema (spec: control metadata + aggregates per quarter).
-- Blob length = N² × G per control's num_states (see constants.ts).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS controls (
  control_id TEXT PRIMARY KEY,
  control_type TEXT NOT NULL CHECK (control_type IN ('discrete', 'slider')),
  num_states INTEGER NOT NULL CHECK (num_states >= 2 AND num_states <= 10),
  state_labels TEXT
);

CREATE TABLE IF NOT EXISTS aggregates (
  control_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  quarter_index INTEGER NOT NULL,
  blob BLOB NOT NULL,
  PRIMARY KEY (control_id, model_id, quarter_index),
  FOREIGN KEY (control_id) REFERENCES controls(control_id)
);
