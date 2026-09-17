/**
 * Storage abstraction for ArcenPay assets (logos today, more later).
 *
 * Drivers: `r2` (Cloudflare R2, S3-compatible, fetch + SigV4) and `local`
 * (filesystem under INVOICE_STORAGE_DIR — dev fallback).
 */

export interface ObjectStore {
  put(
    key: string,
    bytes: Buffer,
    options?: { contentType?: string },
  ): Promise<{ key: string }>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Human readable driver name. */
  readonly driver: "r2" | "local";
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
