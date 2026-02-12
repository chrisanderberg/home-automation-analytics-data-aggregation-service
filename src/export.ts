/**
 * Consistent SQLite snapshot export for offline analysis.
 * Uses the same DB connection as ingestion; the snapshot is consistent at
 * serialize time (bun:sqlite Database.serialize() → write to exports dir).
 */

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const processLogger = {
  error(payload: unknown): void {
    console.error(JSON.stringify(payload));
  },
};

export async function exportSnapshot(
  db: Database,
  exportsDir: string,
  uniqueSuffixFactory: () => string = () => randomUUID().slice(0, 8)
): Promise<string> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const ms = String(now.getUTCMilliseconds()).padStart(3, "0");
  const suffix = uniqueSuffixFactory();
  const filename = `snapshot-${y}${m}${d}-${h}${min}${s}${ms}-${suffix}.sqlite`;
  const filePath = join(exportsDir, filename);

  let serialized: Uint8Array;
  try {
    serialized = db.serialize();
  } catch (err) {
    processLogger.error({
        event: "export_snapshot_failed",
        reason: "serialize failed",
        error: err instanceof Error ? err.message : String(err),
      });
    throw err;
  }

  try {
    await mkdir(exportsDir, { recursive: true });
  } catch (err) {
    processLogger.error({
      event: "export_snapshot_failed",
      step: "mkdir",
      exportsDir,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { raw: String(err) },
    });
    throw err;
  }

  try {
    await Bun.write(filePath, serialized);
  } catch (err) {
    processLogger.error({
        event: "export_snapshot_failed",
        reason: "write failed",
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    throw err;
  }

  return filePath;
}
