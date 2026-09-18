import { promises as fs } from "fs";
import path from "path";
import type { ObjectStore } from "./types.js";

/**
 * Filesystem object store — dev fallback. Files live under the base dir
 * (INVOICE_STORAGE_DIR) mirroring the previous logo path layout.
 */
export class LocalObjectStore implements ObjectStore {
  readonly driver = "local" as const;

  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    if (key.includes("..")) throw new Error("Invalid object key");
    return path.join(this.baseDir, key);
  }

  async put(
    key: string,
    bytes: Buffer,
    _options?: { contentType?: string },
  ): Promise<{ key: string }> {
    const absPath = this.resolve(key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, bytes);
    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const absPath = this.resolve(key);
      return await fs.readFile(absPath);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch {
      // no-op when missing (idempotent)
    }
  }
}
