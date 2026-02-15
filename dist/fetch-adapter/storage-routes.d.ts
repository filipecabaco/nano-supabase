/**
 * Storage routes handler — processes /storage/v1/* requests
 *
 * Intercepts supabase-js storage client calls and handles them locally:
 *   /storage/v1/bucket/*        → bucket CRUD
 *   /storage/v1/object/*        → object upload/download/list/move/copy/remove
 *   /storage/v1/object/sign/*   → signed URL creation & download
 *   /storage/v1/object/public/* → public file download
 *   /storage/v1/object/info/*   → object metadata
 *   /storage/v1/render/*        → image transform (returns original)
 */
import type { PGlite } from "@electric-sql/pglite";
import type { StorageHandler } from "../storage/handler.ts";
export declare function handleStorageRoute(request: Request, pathname: string, db: PGlite, storageHandler: StorageHandler): Promise<Response>;
//# sourceMappingURL=storage-routes.d.ts.map