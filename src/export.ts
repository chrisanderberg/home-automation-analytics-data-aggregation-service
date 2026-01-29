/**
 * Consistent SQLite snapshot export for offline analysis.
 * TODO: implement using node:sqlite backup() — write exports/snapshot-YYYYMMDD-HHMMSS.sqlite
 * (Milestone 8). Service uses exactly one SQLite connection; backup while ingesting.
 */

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function exportSnapshot(
  _db: Database,
  exportsDir: string
): Promise<string> {
  // TODO: use node:sqlite backup() for consistent snapshot (Milestone 8)
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const filename = `snapshot-${y}${m}${d}-${h}${min}${s}.sqlite`;
  const filePath = join(exportsDir, filename);
  await mkdir(exportsDir, { recursive: true });
  // Stub: create empty file so path exists; real backup in M8
  await Bun.write(filePath, "");
  return `${exportsDir}/${filename}`;
}
