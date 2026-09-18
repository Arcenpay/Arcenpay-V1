import { signV4 } from "./s3-signer.js";
import { StorageError, type ObjectStore } from "./types.js";

export interface R2StoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Defaults to https://<accountId>.r2.cloudflarestorage.com */
  endpoint?: string;
  region?: string;
}

/**
 * Cloudflare R2 object store. Buckets are path-style
 * (https://<accountId>.r2.cloudflarestorage.com/bucket/key) and signing uses
 * SigV4 with region `auto`. Uses Node fetch — no SDK dependency.
 */
export class R2ObjectStore implements ObjectStore {
  readonly driver = "r2" as const;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;

  constructor(private readonly config: R2StoreConfig) {
    if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
      throw new StorageError(
        "R2 is not configured. Set STORAGE_DRIVER=r2 plus R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
        500,
        "STORAGE_R2_NOT_CONFIGURED",
      );
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(config.bucket)) {
      throw new StorageError(
        "R2_BUCKET must be the plain bucket name only (e.g. my-bucket), not a URL. " +
          "The S3 API endpoint is derived automatically from R2_ACCOUNT_ID.",
        500,
        "STORAGE_R2_BUCKET_INVALID",
      );
    }
    this.endpoint = (
      config.endpoint ??
      `https://${config.accountId}.r2.cloudflarestorage.com`
    ).replace(/\/+$/, "");
    this.region = config.region ?? "auto";
    this.bucket = config.bucket;
  }

  private encodeKey(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  private objectPath(key: string): string {
    return `/${encodeURIComponent(this.bucket)}/${this.encodeKey(key)}`;
  }

  private async request(
    method: "GET" | "PUT" | "DELETE",
    key: string,
    options?: { body?: Buffer; contentType?: string },
  ): Promise<{ status: number; bytes: Buffer }> {
    const path = this.objectPath(key);
    const host = new URL(this.endpoint).host;
    const body = options?.body ?? Buffer.alloc(0);
    const signed = signV4({
      method,
      path,
      headers: {
        host,
        ...(options?.contentType ? { "content-type": options.contentType } : {}),
      },
      body,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.region,
      service: "s3",
    });

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${path}`, {
        method,
        // Host is derived by fetch automatically; we only sign it.
        headers: {
          Authorization: signed.authorization,
          "x-amz-date": signed.xAmzDate,
          "x-amz-content-sha256": signed.xAmzContentSha256,
          ...(options?.contentType ? { "content-type": options.contentType } : {}),
        },
        body: method === "PUT" ? new Uint8Array(body) : undefined,
      });
    } catch (error) {
      throw new StorageError(
        error instanceof Error ? `R2 request failed: ${error.message}` : "R2 request failed",
        502,
        "STORAGE_R2_NETWORK",
      );
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes };
  }

  private errorDetail(status: number, bytes: Buffer): string {
    if (status < 400) return "";
    // R2/S3 errors are XML: <Error><Code>...</Code><Message>...</Message></Error>.
    const text = bytes.toString("utf8").slice(0, 400);
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
    const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1];
    if (code) return ` (code=${code})${message ? `: ${message.slice(0, 160)}` : ""}`;
    return text.trim() ? ` (${text.trim().slice(0, 160)})` : "";
  }

  async put(
    key: string,
    bytes: Buffer,
    options?: { contentType?: string },
  ): Promise<{ key: string }> {
    const { status } = await this.request("PUT", key, {
      body: bytes,
      contentType: options?.contentType ?? "application/octet-stream",
    });
    if (status >= 400) {
      throw new StorageError(
        `R2 put failed with status ${status}${this.errorDetail(status, bytes)}`,
        status,
        "STORAGE_R2_PUT_FAILED",
      );
    }
    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    const { status, bytes } = await this.request("GET", key);
    if (status === 404) return null;
    if (status >= 400) {
      throw new StorageError(
        `R2 get failed with status ${status}${this.errorDetail(status, bytes)}`,
        status,
        "STORAGE_R2_GET_FAILED",
      );
    }
    return bytes;
  }

  async delete(key: string): Promise<void> {
    const { status, bytes } = await this.request("DELETE", key);
    // 404 is fine (idempotent); anything else >= 400 surfaces.
    if (status >= 400 && status !== 404) {
      throw new StorageError(
        `R2 delete failed with status ${status}${this.errorDetail(status, bytes)}`,
        status,
        "STORAGE_R2_DELETE_FAILED",
      );
    }
  }
}
