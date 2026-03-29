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
export declare function signJWT(payload: JWTPayload, secret: string): Promise<string>;
export declare function verifyJWT(token: string, secret: string): Promise<{
    valid: boolean;
    payload?: JWTPayload;
    error?: string;
}>;
export declare function decodeJWT(token: string): JWTPayload | null;
//# sourceMappingURL=jwt.d.ts.map