/**
 * Crypto utilities for auth tokens
 * Uses Web Crypto API for JWT operations (browser/edge runtime compatible)
 */
import type { PGlite } from '@electric-sql/pglite';
import type { User, TokenPair } from './types.ts';
/**
 * Create an access token using Web Crypto API
 */
export declare function createAccessToken(db: PGlite, user: User, sessionId: string, expiresIn?: number): Promise<string>;
/**
 * Verify and decode an access token using Web Crypto API
 */
export declare function verifyAccessToken(db: PGlite, token: string): Promise<{
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
/**
 * Generate a token pair (access + refresh) for a user session
 */
export declare function generateTokenPair(db: PGlite, user: User, sessionId: string, refreshToken: string, expiresIn?: number): Promise<TokenPair>;
/**
 * Extract user ID from access token without full verification
 * (useful for quick checks, but should verify for security-sensitive operations)
 */
export declare function extractUserIdFromToken(token: string): string | null;
/**
 * Extract session ID from access token without full verification
 */
export declare function extractSessionIdFromToken(token: string): string | null;
//# sourceMappingURL=crypto.d.ts.map