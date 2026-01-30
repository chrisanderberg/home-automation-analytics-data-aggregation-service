/**
 * Consistent SQLite snapshot export for offline analysis.
 * Uses the same DB connection as ingestion; the snapshot is consistent at
 * serialize time (bun:sqlite Database.serialize() → write to exports dir).
 */

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function exportSnapshot(
  db: Database,
  exportsDir: string
): Promise<string> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const filename = `snapshot-${y}${m}${d}-${h}${min}${s}.sqlite`;
  const filePath = join(exportsDir, filename);

  let serialized: Uint8Array;
  try {
    serialized = db.serialize();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        event: "export_snapshot_failed",
        reason: "serialize failed",
        error: message,
      })
    );
    throw err;
  }

  await mkdir(exportsDir, { recursive: true });

  try {
    await Bun.write(filePath, serialized);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        event: "export_snapshot_failed",
        reason: "write failed",
        path: filePath,
        error: message,
      })
    );
    throw err;
  }

  return `${exportsDir}/${filename}`;
}
