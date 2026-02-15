/**
 * StorageHandler — manages bucket and object operations against PGlite
 *
 * All metadata lives in storage.buckets / storage.objects (with RLS).
 * File blobs are stored in a pluggable StorageBackend (in-memory by default).
 */

import type { PGlite } from "@electric-sql/pglite";
import type { StorageBackend, BlobMetadata } from "./backend.ts";
import { MemoryStorageBackend } from "./backend.ts";
import { STORAGE_SCHEMA_SQL } from "./schema.ts";

// ─── Types ────────────────────────────────────────────────────────────

export interface StorageBucket {
  id: string;
  name: string;
  owner: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  public: boolean;
  avif_autodetection: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

export interface StorageObject {
  id: string;
  bucket_id: string;
  name: string;
  owner: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  metadata: Record<string, unknown> | null;
  version: string | null;
  user_metadata: Record<string, unknown> | null;
}

export interface CreateBucketOptions {
  id?: string;
  name: string;
  public?: boolean;
  file_size_limit?: number;
  allowed_mime_types?: string[];
}

export interface SignedUrlToken {
  bucket_id: string;
  object_name: string;
  exp: number;
}

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafeBase64(b64url: string): string {
  let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return s;
}

// ─── Handler ──────────────────────────────────────────────────────────

export class StorageHandler {
  private db: PGlite;
  private backend: StorageBackend;
  private initialized = false;

  constructor(db: PGlite, backend?: StorageBackend) {
    this.db = db;
    this.backend = backend ?? new MemoryStorageBackend();
  }

  /** Initialize the storage schema in PGlite */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.db.exec(STORAGE_SCHEMA_SQL);
    this.initialized = true;
  }

  /** Get the blob backend (for advanced use) */
  getBackend(): StorageBackend {
    return this.backend;
  }

  // ── Bucket operations ────────────────────────────────────────────

  async listBuckets(): Promise<StorageBucket[]> {
    await this.initialize();
    const result = await this.db.query<StorageBucket>(
      "SELECT * FROM storage.buckets ORDER BY name",
    );
    return result.rows;
  }

  async getBucket(id: string): Promise<StorageBucket | null> {
    await this.initialize();
    const result = await this.db.query<StorageBucket>(
      "SELECT * FROM storage.buckets WHERE id = $1",
      [id],
    );
    return result.rows[0] ?? null;
  }

  async createBucket(options: CreateBucketOptions): Promise<StorageBucket> {
    await this.initialize();
    const id = options.id ?? options.name;
    const result = await this.db.query<StorageBucket>(
      `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        id,
        options.name,
        options.public ?? false,
        options.file_size_limit ?? null,
        options.allowed_mime_types ?? null,
      ],
    );
    const bucket = result.rows[0];
    if (!bucket) throw new Error("Failed to create bucket");
    return bucket;
  }

  async updateBucket(
    id: string,
    options: Partial<
      Pick<
        CreateBucketOptions,
        "public" | "file_size_limit" | "allowed_mime_types"
      >
    >,
  ): Promise<StorageBucket> {
    await this.initialize();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (options.public !== undefined) {
      sets.push(`public = $${idx++}`);
      params.push(options.public);
    }
    if (options.file_size_limit !== undefined) {
      sets.push(`file_size_limit = $${idx++}`);
      params.push(options.file_size_limit);
    }
    if (options.allowed_mime_types !== undefined) {
      sets.push(`allowed_mime_types = $${idx++}`);
      params.push(options.allowed_mime_types);
    }

    if (sets.length === 0) {
      const bucket = await this.getBucket(id);
      if (!bucket) throw new Error("Bucket not found");
      return bucket;
    }

    sets.push("updated_at = now()");
    params.push(id);

    const result = await this.db.query<StorageBucket>(
      `UPDATE storage.buckets SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );
    const bucket = result.rows[0];
    if (!bucket) throw new Error("Bucket not found");
    return bucket;
  }

  async emptyBucket(id: string): Promise<void> {
    await this.initialize();
    // Delete all object rows (RLS applies)
    await this.db.query("DELETE FROM storage.objects WHERE bucket_id = $1", [
      id,
    ]);
    // Delete all blobs for this bucket
    await this.backend.deleteByPrefix(`${id}/`);
  }

  async deleteBucket(id: string): Promise<void> {
    await this.initialize();
    // Check bucket is empty
    const objects = await this.db.query<{ count: string }>(
      "SELECT count(*)::text as count FROM storage.objects WHERE bucket_id = $1",
      [id],
    );
    if (objects.rows[0] && parseInt(objects.rows[0].count, 10) > 0) {
      throw new Error("Bucket not empty");
    }
    await this.db.query("DELETE FROM storage.buckets WHERE id = $1", [id]);
  }

  // ── Object operations ────────────────────────────────────────────

  async uploadObject(
    bucketId: string,
    objectName: string,
    data: Uint8Array,
    contentType: string,
    options?: {
      cacheControl?: string;
      upsert?: boolean;
      userMetadata?: Record<string, unknown>;
      ownerId?: string;
    },
  ): Promise<StorageObject> {
    await this.initialize();

    // Validate bucket exists and check constraints
    const bucket = await this.getBucket(bucketId);
    if (!bucket) throw new Error("Bucket not found");

    // Check file size limit
    if (bucket.file_size_limit && data.byteLength > bucket.file_size_limit) {
      throw new Error(
        `File size ${data.byteLength} exceeds bucket limit of ${bucket.file_size_limit}`,
      );
    }

    // Check allowed MIME types
    if (bucket.allowed_mime_types && bucket.allowed_mime_types.length > 0) {
      const allowed = bucket.allowed_mime_types.some((mime) => {
        if (mime.endsWith("/*")) {
          return contentType.startsWith(mime.slice(0, -1));
        }
        return contentType === mime;
      });
      if (!allowed) {
        throw new Error(`MIME type ${contentType} is not allowed in this bucket`);
      }
    }

    const metadata: Record<string, unknown> = {
      eTag: `"${await this.computeETag(data)}"`,
      size: data.byteLength,
      mimetype: contentType,
      cacheControl: options?.cacheControl ?? "max-age=3600",
      lastModified: new Date().toISOString(),
      contentLength: data.byteLength,
      httpStatusCode: 200,
    };

    const upsert = options?.upsert ?? false;

    let result;
    if (upsert) {
      result = await this.db.query<StorageObject>(
        `INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         ON CONFLICT (bucket_id, name)
         DO UPDATE SET
           metadata = $4,
           user_metadata = $5,
           updated_at = now(),
           last_accessed_at = now(),
           version = gen_random_uuid()::text,
           owner_id = EXCLUDED.owner_id
         RETURNING *`,
        [
          bucketId,
          objectName,
          options?.ownerId ?? null,
          JSON.stringify(metadata),
          options?.userMetadata ? JSON.stringify(options.userMetadata) : null,
        ],
      );
    } else {
      result = await this.db.query<StorageObject>(
        `INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         RETURNING *`,
        [
          bucketId,
          objectName,
          options?.ownerId ?? null,
          JSON.stringify(metadata),
          options?.userMetadata ? JSON.stringify(options.userMetadata) : null,
        ],
      );
    }

    const obj = result.rows[0];
    if (!obj) throw new Error("Failed to create object");

    // Store the blob
    const blobKey = `${bucketId}/${objectName}`;
    await this.backend.put(blobKey, data, {
      contentType,
      size: data.byteLength,
      cacheControl: options?.cacheControl,
    });

    return obj;
  }

  async downloadObject(
    bucketId: string,
    objectName: string,
  ): Promise<{ data: Uint8Array; metadata: BlobMetadata; object: StorageObject } | null> {
    await this.initialize();

    // Check object exists in DB (RLS applies)
    const result = await this.db.query<StorageObject>(
      `UPDATE storage.objects
       SET last_accessed_at = now()
       WHERE bucket_id = $1 AND name = $2
       RETURNING *`,
      [bucketId, objectName],
    );
    const obj = result.rows[0];
    if (!obj) return null;

    // Get blob
    const blobKey = `${bucketId}/${objectName}`;
    const blob = await this.backend.get(blobKey);
    if (!blob) return null;

    return { data: blob.data, metadata: blob.metadata, object: obj };
  }

  async getObjectInfo(
    bucketId: string,
    objectName: string,
  ): Promise<StorageObject | null> {
    await this.initialize();
    const result = await this.db.query<StorageObject>(
      "SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",
      [bucketId, objectName],
    );
    return result.rows[0] ?? null;
  }

  async objectExists(
    bucketId: string,
    objectName: string,
  ): Promise<boolean> {
    await this.initialize();
    const result = await this.db.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2) as exists",
      [bucketId, objectName],
    );
    return result.rows[0]?.exists ?? false;
  }

  async removeObjects(
    bucketId: string,
    paths: string[],
  ): Promise<StorageObject[]> {
    await this.initialize();
    if (paths.length === 0) return [];

    // Delete from DB (RLS applies)
    const placeholders = paths.map((_, i) => `$${i + 2}`).join(", ");
    const result = await this.db.query<StorageObject>(
      `DELETE FROM storage.objects
       WHERE bucket_id = $1 AND name IN (${placeholders})
       RETURNING *`,
      [bucketId, ...paths],
    );

    // Delete blobs
    for (const obj of result.rows) {
      await this.backend.delete(`${bucketId}/${obj.name}`);
    }

    return result.rows;
  }

  async listObjects(
    bucketId: string,
    options?: {
      prefix?: string;
      limit?: number;
      offset?: number;
      sortBy?: { column: string; order: string };
      search?: string;
    },
  ): Promise<StorageObject[]> {
    await this.initialize();

    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const sortColumn = options?.sortBy?.column ?? "name";
    const sortOrder =
      options?.sortBy?.order?.toLowerCase() === "desc" ? "DESC" : "ASC";

    // Allowed sort columns for safety
    const allowedColumns = [
      "name",
      "created_at",
      "updated_at",
      "last_accessed_at",
    ];
    const safeColumn = allowedColumns.includes(sortColumn)
      ? sortColumn
      : "name";

    // Use the search function pattern: find objects at the given prefix level
    // The supabase-js client sends prefix as the folder path, and we need to list
    // items one level deep within that prefix
    const searchPattern = prefix ? `${prefix}%` : "%";

    const result = await this.db.query<StorageObject>(
      `SELECT * FROM storage.objects
       WHERE bucket_id = $1 AND name LIKE $2
       ORDER BY ${safeColumn} ${sortOrder}
       LIMIT $3 OFFSET $4`,
      [bucketId, searchPattern, limit, offset],
    );

    return result.rows;
  }

  async moveObject(
    bucketId: string,
    sourceKey: string,
    destinationKey: string,
    destinationBucket?: string,
  ): Promise<void> {
    await this.initialize();

    const destBucket = destinationBucket ?? bucketId;

    // Update DB row
    const result = await this.db.query(
      `UPDATE storage.objects
       SET bucket_id = $3, name = $4, updated_at = now()
       WHERE bucket_id = $1 AND name = $2`,
      [bucketId, sourceKey, destBucket, destinationKey],
    );

    if ((result as { rowCount?: number }).rowCount === 0) {
      throw new Error("Object not found");
    }

    // Move blob
    const fromKey = `${bucketId}/${sourceKey}`;
    const toKey = `${destBucket}/${destinationKey}`;
    const copied = await this.backend.copy(fromKey, toKey);
    if (copied) {
      await this.backend.delete(fromKey);
    }
  }

  async copyObject(
    bucketId: string,
    sourceKey: string,
    destinationKey: string,
    destinationBucket?: string,
  ): Promise<string> {
    await this.initialize();

    const destBucket = destinationBucket ?? bucketId;

    // Get source object (RLS applies)
    const source = await this.db.query<StorageObject>(
      "SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",
      [bucketId, sourceKey],
    );
    const srcObj = source.rows[0];
    if (!srcObj) throw new Error("Object not found");

    // Insert new object row
    const result = await this.db.query<StorageObject>(
      `INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
       VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
       ON CONFLICT (bucket_id, name)
       DO UPDATE SET
         metadata = EXCLUDED.metadata,
         user_metadata = EXCLUDED.user_metadata,
         updated_at = now(),
         version = gen_random_uuid()::text
       RETURNING *`,
      [
        destBucket,
        destinationKey,
        srcObj.owner_id,
        JSON.stringify(srcObj.metadata),
        srcObj.user_metadata ? JSON.stringify(srcObj.user_metadata) : null,
      ],
    );
    const newObj = result.rows[0];
    if (!newObj) throw new Error("Failed to copy object");

    // Copy blob
    const fromKey = `${bucketId}/${sourceKey}`;
    const toKey = `${destBucket}/${destinationKey}`;
    await this.backend.copy(fromKey, toKey);

    return `${destBucket}/${destinationKey}`;
  }

  // ── Signed URLs ──────────────────────────────────────────────────

  /**
   * Create a signed URL token.
   * We use a simple HMAC-based approach reusing the auth signing key.
   */
  async createSignedUrl(
    bucketId: string,
    objectName: string,
    expiresIn: number,
  ): Promise<string> {
    await this.initialize();

    // Verify object exists
    const exists = await this.objectExists(bucketId, objectName);
    if (!exists) throw new Error("Object not found");

    const payload: SignedUrlToken = {
      bucket_id: bucketId,
      object_name: objectName,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    };

    // Get signing key via SECURITY DEFINER function
    const keyResult = await this.db.query<{ get_signing_key: string }>(
      "SELECT auth.get_signing_key()",
    );
    const signingKey = keyResult.rows[0]?.get_signing_key ?? crypto.randomUUID();

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const payloadStr = JSON.stringify(payload);
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payloadStr),
    );

    const payloadB64 = toUrlSafeBase64(btoa(payloadStr));
    const sigB64 = toUrlSafeBase64(btoa(
      String.fromCharCode(...new Uint8Array(signature)),
    ));

    return `${payloadB64}.${sigB64}`;
  }

  /**
   * Verify a signed URL token and return the payload
   */
  async verifySignedUrl(token: string): Promise<SignedUrlToken | null> {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts;

    try {
      const payloadStr = atob(fromUrlSafeBase64(payloadB64!));
      const payload: SignedUrlToken = JSON.parse(payloadStr);

      if (payload.exp < Math.floor(Date.now() / 1000)) return null;

      const keyResult = await this.db.query<{ get_signing_key: string }>(
        "SELECT auth.get_signing_key()",
      );
      if (!keyResult.rows[0]) return null;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(keyResult.rows[0].get_signing_key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );

      const sigBytes = Uint8Array.from(atob(fromUrlSafeBase64(sigB64!)), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify(
        "HMAC",
        key,
        sigBytes,
        encoder.encode(payloadStr),
      );

      return valid ? payload : null;
    } catch {
      return null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Simple hash for ETags */
  private async computeETag(data: Uint8Array): Promise<string> {
    try {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = new Uint8Array(hashBuffer);
      return Array.from(hashArray.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fallback for environments without crypto.subtle
      return Math.random().toString(36).slice(2, 18);
    }
  }
}
