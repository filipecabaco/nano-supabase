/**
 * JWT utilities using Web Crypto API
 * Compatible with: Browser, Cloudflare Workers, Deno, Bun
 */
/**
 * JWT payload structure
 */
export interface JWTPayload {
    sub: string;
    aud: string;
    role: string;
    email?: string;
    session_id: string;
    iat: number;
    exp: number;
    user_metadata: Record<string, unknown>;
    app_metadata: Record<string, unknown>;
}
/**
 * Sign a JWT using HMAC-SHA256 (Web Crypto API)
 */
export declare function signJWT(payload: JWTPayload, secret: string): Promise<string>;
/**
 * Verify a JWT signature using HMAC-SHA256 (Web Crypto API)
 */
export declare function verifyJWT(token: string, secret: string): Promise<{
    valid: boolean;
    payload?: JWTPayload;
    error?: string;
}>;
/**
 * Decode JWT payload without verification (for quick checks)
 */
export declare function decodeJWT(token: string): JWTPayload | null;
//# sourceMappingURL=jwt.d.ts.map