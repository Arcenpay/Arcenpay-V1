import {
  INVOICE_STORAGE_DIR,
  R2_ACCESS_KEY_ID,
  R2_ACCOUNT_ID,
  R2_BUCKET,
  R2_SECRET_ACCESS_KEY,
  STORAGE_DRIVER,
} from "../../config.js";
import { LocalObjectStore } from "./local-store.js";
import { R2ObjectStore } from "./r2-store.js";
import type { ObjectStore } from "./types.js";

export { StorageError } from "./types.js";
export type { ObjectStore } from "./types.js";
export { R2ObjectStore } from "./r2-store.js";
export { LocalObjectStore } from "./local-store.js";

let instance: ObjectStore | null = null;

/**
 * Resolves and memoizes the active object store:
 * - STORAGE_DRIVER=r2 + R2_* vars → Cloudflare R2 (production path)
 * - otherwise → local filesystem under INVOICE_STORAGE_DIR (dev fallback)
 */
export function getStorage(): ObjectStore {
  if (instance) return instance;
  if (STORAGE_DRIVER === "r2") {
    instance = new R2ObjectStore({
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
    });
  } else {
    instance = new LocalObjectStore(INVOICE_STORAGE_DIR);
  }
  return instance;
}

