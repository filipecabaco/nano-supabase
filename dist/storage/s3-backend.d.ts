import type { BlobMetadata, StorageBackend } from "./backend.ts";
export interface S3StorageBackendOptions {
    bucket: string;
    prefix?: string;
    endpoint?: string;
    region?: string;
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
    };
}
export declare class S3StorageBackend implements StorageBackend {
    private readonly bucket;
    private readonly prefix;
    private readonly baseUrl;
    private readonly aws;
    constructor(options: S3StorageBackendOptions);
    private url;
    private metaUrl;
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
//# sourceMappingURL=s3-backend.d.ts.map