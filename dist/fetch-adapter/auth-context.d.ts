/**
 * Auth context management for RLS policies
 * Handles setting and clearing PostgreSQL session context for authenticated requests
 */
import type { PGlite } from "@electric-sql/pglite";
export interface AuthContext {
    userId?: string;
    role: string;
    email?: string;
}
/**
 * Set auth context for authenticated request
 */
export declare function setAuthContext(db: PGlite, token: string | null): Promise<AuthContext>;
/**
 * Clear auth context (set to anonymous)
 */
export declare function clearAuthContext(db: PGlite): Promise<void>;
//# sourceMappingURL=auth-context.d.ts.map