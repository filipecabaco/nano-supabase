/**
 * Data routes handler - processes /rest/v1/* requests using PostgREST parser
 */
import type { PGlite } from "@electric-sql/pglite";
import type { PostgrestParser } from "../postgrest-parser.ts";
/**
 * Handle data routes (PostgREST API)
 */
export declare function handleDataRoute(request: Request, pathname: string, db: PGlite, parser: PostgrestParser): Promise<Response>;
//# sourceMappingURL=data-routes.d.ts.map