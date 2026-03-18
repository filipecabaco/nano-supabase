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
    get(key: string): Promise<{
        data: Uint8Array;
        metadata: BlobMetadata;
    } | null>;
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
export declare class MemoryStorageBackend implements StorageBackend {
    private store;
    put(key: string, data: Uint8Array, metadata: BlobMetadata): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        metadata: BlobMetadata;
    } | null>;
    delete(key: string): Promise<boolean>;
    deleteByPrefix(prefix: string): Promise<number>;
    exists(key: string): Promise<boolean>;
    copy(fromKey: string, toKey: string): Promise<boolean>;
}
//# sourceMappingURL=backend.d.ts.map