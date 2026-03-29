import type { PGliteInterface } from "@electric-sql/pglite";
export interface AuthContext {
    userId?: string;
    role: string;
    email?: string;
}
export declare function setAuthContext(db: PGliteInterface, token: string | null): Promise<AuthContext>;
export declare function clearAuthContext(db: PGliteInterface): Promise<void>;
//# sourceMappingURL=auth-context.d.ts.map