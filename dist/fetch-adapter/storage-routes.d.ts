import type { PGliteInterface } from "@electric-sql/pglite";
import type { StorageHandler } from "../storage/handler.ts";
interface TusSession {
    bucketId: string;
    objectName: string;
    contentType: string;
    cacheControl?: string;
    upsert: boolean;
    ownerId?: string;
    uploadLength: number;
    chunks: Uint8Array[];
    offset: number;
    createdAt: number;
}
export type TusSessionMap = Map<string, TusSession>;
export declare function handleStorageRoute(request: Request, pathname: string, db: PGliteInterface, storageHandler: StorageHandler, tusSessions: TusSessionMap): Promise<Response>;
export {};
//# sourceMappingURL=storage-routes.d.ts.map