/**
 * Pluggable blob storage backends for storing file data
 *
 * Default: in-memory Map (works everywhere — web containers, browsers, Deno, Node)
 * Users can provide their own backend (e.g., IndexedDB, OPFS, filesystem)
 */

/**
 * Metadata stored alongside each blob
 */
export interface BlobMetadata {
  /** MIME type of the file */
  contentType: string;
  /** Size in bytes */
  size: number;
  /** Cache-Control header value */
  cacheControl?: string;
}

/**
 * Interface for pluggable blob storage
 */
export interface StorageBackend {
  /** Store a blob. Key format: "bucketId/objectName" */
  put(key: string, data: Uint8Array, metadata: BlobMetadata): Promise<void>;

  /** Retrieve a blob. Returns null if not found. */
  get(key: string): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null>;

  /** Delete a blob. Returns true if it existed. */
  delete(key: string): Promise<boolean>;

  /** Delete all blobs with the given key prefix (e.g., "bucketId/") */
  deleteByPrefix(prefix: string): Promise<number>;

  /** Check if a blob exists */
  exists(key: string): Promise<boolean>;

  /** Copy a blob from one key to another */
  copy(fromKey: string, toKey: string): Promise<boolean>;
}

/**
 * In-memory blob storage backend
 *
 * Best default for web containers and AI agent workflows:
 * - Zero dependencies, zero config
 * - Works in every JS runtime
 * - Fast (no async I/O overhead)
 * - Ephemeral (data lost on reload — fine for dev/prototyping)
 */
export class MemoryStorageBackend implements StorageBackend {
  private store = new Map<
    string,
    { data: Uint8Array; metadata: BlobMetadata }
  >();

  async put(
    key: string,
    data: Uint8Array,
    metadata: BlobMetadata,
  ): Promise<void> {
    this.store.set(key, { data, metadata });
  }

  async get(
    key: string,
  ): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const entry = this.store.get(fromKey);
    if (!entry) return false;
    // Copy the data buffer to avoid shared references
    this.store.set(toKey, {
      data: new Uint8Array(entry.data),
      metadata: { ...entry.metadata },
    });
    return true;
  }
}
