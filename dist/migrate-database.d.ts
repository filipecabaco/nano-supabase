import type { PGliteInterface } from "@electric-sql/pglite";
export interface MigrateResult {
    schema: {
        tables: number;
        migrations: number;
        views: number;
        functions: number;
        triggers: number;
        policies: number;
    };
    auth: {
        users: number;
        identities: number;
    };
    data: {
        tables: number;
        rows: number;
    };
    storage: {
        buckets: number;
        objects: number;
    };
}
export interface MigrateOptions {
    skipSchema?: boolean;
    skipAuth?: boolean;
    skipData?: boolean;
    skipStorage?: boolean;
    dryRun?: boolean;
    migrationsDir?: string;
}
export interface StorageTransfer {
    download: (bucketId: string, name: string) => Promise<{
        data: ArrayBuffer;
        contentType: string;
    } | null>;
    upload: (bucketId: string, name: string, data: ArrayBuffer, contentType: string) => Promise<boolean>;
}
type QueryResult = {
    rows: Record<string, unknown>[];
};
export type ExecuteOnTarget = (sql: string, params?: unknown[]) => Promise<QueryResult>;
export declare function migrateDatabase(sourceDb: PGliteInterface, executeOnTarget: ExecuteOnTarget, options: MigrateOptions, storageTransfer?: StorageTransfer): Promise<MigrateResult>;
export {};
//# sourceMappingURL=migrate-database.d.ts.map