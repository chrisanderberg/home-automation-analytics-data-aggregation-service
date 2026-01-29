import { Temporal } from "@js-temporal/polyfill";

export interface Config {
  timeZone: string;
  latitudeDeg: number;
  longitudeDeg: number;
  sqlitePath: string;
  exportsDir: string;
  port: number;
  maxHoldingIntervalMs: number;
}

function parseNum(
  key: string,
  value: string | undefined,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (value === undefined || value === "") return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(
      `Invalid ${key}: must be a number between ${min} and ${max} (got: ${value})`
    );
  }
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const timeZone = env.TIME_ZONE;
  if (!timeZone || timeZone.trim() === "") {
    throw new Error("TIME_ZONE is required (IANA timezone, e.g. America/Los_Angeles)");
  }
  try {
    Temporal.Now.zonedDateTimeISO(timeZone.trim());
  } catch {
    throw new Error(`Invalid TIME_ZONE: ${timeZone}`);
  }

  const lat = parseNum(
    "LATITUDE_DEG",
    env.LATITUDE_DEG,
    -90,
    90,
    NaN
  );
  if (Number.isNaN(lat)) {
    throw new Error("LATITUDE_DEG is required (number in [-90, 90])");
  }

  const lon = parseNum(
    "LONGITUDE_DEG",
    env.LONGITUDE_DEG,
    -180,
    180,
    NaN
  );
  if (Number.isNaN(lon)) {
    throw new Error("LONGITUDE_DEG is required (number in [-180, 180])");
  }

  return {
    timeZone: timeZone.trim(),
    latitudeDeg: lat,
    longitudeDeg: lon,
    sqlitePath: env.SQLITE_PATH?.trim() || "data.sqlite",
    exportsDir: env.EXPORTS_DIR?.trim() || "exports",
    port: parseNum("PORT", env.PORT, 1, 65535, 8787),
    maxHoldingIntervalMs: parseNum(
      "MAX_HOLDING_INTERVAL_MS",
      env.MAX_HOLDING_INTERVAL_MS,
      1,
      Number.MAX_SAFE_INTEGER,
      14 * 24 * 60 * 60 * 1000
    ),
  };
}
