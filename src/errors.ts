/**
 * Custom error type for integrity failures (e.g. control missing, num_states
 * mismatch, aggregate blob length mismatch). Used so the server can classify
 * these as 400 client errors instead of 500.
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
    Object.setPrototypeOf(this, IntegrityError.prototype);
  }
}

/** Type guard: true if e is an IntegrityError (discard ingestion with 400). */
export function isIntegrityError(e: unknown): e is IntegrityError {
  return e instanceof IntegrityError;
}
