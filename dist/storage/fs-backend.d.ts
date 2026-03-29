import type { BlobMetadata, StorageBackend } from "./backend.ts";
export declare class FileSystemStorageBackend implements StorageBackend {
    private readonly baseDir;
    constructor(baseDir: string);
    private safePath;
    private blobPath;
    private metaPath;
    put(key: string, data: Uint8Array, metadata: BlobMetadata): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        metadata: BlobMetadata;
    } | null>;
    delete(key: string): Promise<boolean>;
    deleteByPrefix(prefix: string): Promise<number>;
    private countFiles;
    exists(key: string): Promise<boolean>;
    copy(fromKey: string, toKey: string): Promise<boolean>;
}
//# sourceMappingURL=fs-backend.d.ts.map