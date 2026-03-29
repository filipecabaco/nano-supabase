export interface BlobMetadata {
    contentType: string;
    size: number;
    cacheControl?: string;
}
export interface StorageBackend {
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