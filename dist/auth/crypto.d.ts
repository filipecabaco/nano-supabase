import type { PGliteInterface } from "@electric-sql/pglite";
import type { TokenPair, User } from "./types.ts";
export declare function createAccessToken(db: PGliteInterface, user: User, sessionId: string, expiresIn?: number): Promise<string>;
export declare function verifyAccessToken(db: PGliteInterface, token: string): Promise<{
    valid: boolean;
    payload?: {
        sub: string;
        aud: string;
        role: string;
        email?: string;
        session_id: string;
        iat: number;
        exp: number;
        user_metadata: Record<string, unknown>;
        app_metadata: Record<string, unknown>;
    };
    error?: string;
}>;
export declare function generateTokenPair(db: PGliteInterface, user: User, sessionId: string, refreshToken: string, expiresIn?: number): Promise<TokenPair>;
export declare function extractUserIdFromToken(token: string): string | null;
export declare function extractSessionIdFromToken(token: string): string | null;
//# sourceMappingURL=crypto.d.ts.map