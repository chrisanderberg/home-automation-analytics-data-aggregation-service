import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, applySchema, upsertControl, getControl } from "./db.js";
import { exportSnapshot } from "./export.js";

describe("exportSnapshot", () => {
  test("writes consistent SQLite snapshot; exported file contains schema and data", async () => {
    const db = openDb(":memory:");
    try {
      applySchema(db);
      const controlId = "export-test-control";
      upsertControl(db, controlId, "discrete", 6, ["a", "b", "c", "d", "e", "f"]);

      const exportsDir = mkdtempSync(join(tmpdir(), "export-test-"));
      try {
        const path = await exportSnapshot(db, exportsDir);
        expect(path).toContain("snapshot-");
        expect(path).toMatch(/snapshot-\d{8}-\d{9}\.sqlite$/);

        const snapshotDb = openDb(path);
        try {
          const control = getControl(snapshotDb, controlId);
          expect(control).not.toBeNull();
          expect(control!.controlType).toBe("discrete");
          expect(control!.numStates).toBe(6);
          expect(control!.stateLabels).toEqual(["a", "b", "c", "d", "e", "f"]);
        } finally {
          snapshotDb.close();
        }
      } finally {
        rmSync(exportsDir, { recursive: true, force: true });
      }
    } finally {
      db.close();
    }
  });
});
