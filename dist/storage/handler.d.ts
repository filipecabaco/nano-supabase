/**
 * StorageHandler — manages bucket and object operations against PGlite
 *
 * All metadata lives in storage.buckets / storage.objects (with RLS).
 * File blobs are stored in a pluggable StorageBackend (in-memory by default).
 */
import type { PGlite } from "@electric-sql/pglite";
import type { StorageBackend, BlobMetadata } from "./backend.ts";
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
export declare class StorageHandler {
    private db;
    private backend;
    private initialized;
    constructor(db: PGlite, backend?: StorageBackend);
    /** Initialize the storage schema in PGlite */
    initialize(): Promise<void>;
    /** Get the blob backend (for advanced use) */
    getBackend(): StorageBackend;
    listBuckets(): Promise<StorageBucket[]>;
    getBucket(id: string): Promise<StorageBucket | null>;
    createBucket(options: CreateBucketOptions): Promise<StorageBucket>;
    updateBucket(id: string, options: Partial<Pick<CreateBucketOptions, "public" | "file_size_limit" | "allowed_mime_types">>): Promise<StorageBucket>;
    emptyBucket(id: string): Promise<void>;
    deleteBucket(id: string): Promise<void>;
    uploadObject(bucketId: string, objectName: string, data: Uint8Array, contentType: string, options?: {
        cacheControl?: string;
        upsert?: boolean;
        userMetadata?: Record<string, unknown>;
        ownerId?: string;
    }): Promise<StorageObject>;
    downloadObject(bucketId: string, objectName: string): Promise<{
        data: Uint8Array;
        metadata: BlobMetadata;
        object: StorageObject;
    } | null>;
    getObjectInfo(bucketId: string, objectName: string): Promise<StorageObject | null>;
    objectExists(bucketId: string, objectName: string): Promise<boolean>;
    removeObjects(bucketId: string, paths: string[]): Promise<StorageObject[]>;
    listObjects(bucketId: string, options?: {
        prefix?: string;
        limit?: number;
        offset?: number;
        sortBy?: {
            column: string;
            order: string;
        };
        search?: string;
    }): Promise<StorageObject[]>;
    moveObject(bucketId: string, sourceKey: string, destinationKey: string, destinationBucket?: string): Promise<void>;
    copyObject(bucketId: string, sourceKey: string, destinationKey: string, destinationBucket?: string): Promise<string>;
    /**
     * Create a signed URL token.
     * We use a simple HMAC-based approach reusing the auth signing key.
     */
    createSignedUrl(bucketId: string, objectName: string, expiresIn: number): Promise<string>;
    /**
     * Verify a signed URL token and return the payload
     */
    verifySignedUrl(token: string): Promise<SignedUrlToken | null>;
    /** Simple hash for ETags */
    private computeETag;
}
//# sourceMappingURL=handler.d.ts.map