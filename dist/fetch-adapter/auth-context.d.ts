/**
 * Auth context management for RLS policies
 * Handles setting and clearing PostgreSQL session context for authenticated requests
 */
import type { PGliteInterface } from "@electric-sql/pglite";
export interface AuthContext {
    userId?: string;
    role: string;
    email?: string;
}
/**
 * Set auth context for authenticated request
 */
export declare function setAuthContext(db: PGliteInterface, token: string | null): Promise<AuthContext>;
/**
 * Clear auth context (set to anonymous)
 */
export declare function clearAuthContext(db: PGliteInterface): Promise<void>;
//# sourceMappingURL=auth-context.d.ts.map