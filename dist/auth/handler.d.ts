import type { PGliteInterface } from "@electric-sql/pglite";
import type { AuthError, AuthResponse, AuthStateChangeCallback, AuthSubscription, Session, User } from "./types.ts";
export declare class AuthHandler {
    private readonly db;
    private initPromise;
    private subscriptions;
    private currentSession;
    constructor(db: PGliteInterface);
    initialize(): Promise<void>;
    private emitAuthStateChange;
    onAuthStateChange(callback: AuthStateChangeCallback): AuthSubscription;
    private signInAndCreateSession;
    signUp(email: string, password: string, options?: {
        data?: Record<string, unknown>;
    }): Promise<AuthResponse>;
    signInWithPassword(email: string, password: string): Promise<AuthResponse>;
    private createSession;
    refreshSession(refreshToken: string): Promise<AuthResponse>;
    signOut(accessToken?: string): Promise<{
        error: AuthError | null;
    }>;
    getUser(accessToken: string): Promise<{
        data: {
            user: User | null;
        };
        error: AuthError | null;
    }>;
    private verifyNonce;
    updateUser(accessToken: string, attributes: {
        email?: string;
        password?: string;
        data?: Record<string, unknown>;
        nonce?: string;
    }): Promise<AuthResponse>;
    adminListUsers(page?: number, perPage?: number): Promise<{
        users: User[];
        total: number;
    }>;
    adminGetUser(id: string): Promise<User | null>;
    adminCreateUser(attrs: {
        email?: string;
        phone?: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
    }): Promise<User>;
    adminUpdateUser(id: string, attrs: {
        email?: string;
        phone?: string;
        password?: string;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
        ban_duration?: string;
        email_confirm?: boolean;
    }): Promise<User | null>;
    adminDeleteUser(id: string): Promise<void>;
    getSession(): Session | null;
    setSession(session: Session | null): void;
    private writeAuditLog;
    private generateOneTimeToken;
    private consumeOneTimeToken;
    signInAnonymously(): Promise<AuthResponse>;
    sendOtp(email: string): Promise<{
        token: string;
    }>;
    sendRecovery(email: string): Promise<{
        token: string | null;
    }>;
    verifyOtp(rawToken: string, type: string): Promise<AuthResponse>;
    sendInvite(email: string): Promise<{
        token: string;
    }>;
    reauthenticate(accessToken: string): Promise<{
        error: AuthError | null;
    }>;
    enrollTOTP(accessToken: string, friendlyName?: string): Promise<{
        id: string;
        type: string;
        totp: {
            qr_code: string;
            secret: string;
            uri: string;
        };
    } | null>;
    challengeTOTP(accessToken: string, factorId: string): Promise<{
        id: string;
        expires_at: number;
    } | null>;
    verifyTOTP(accessToken: string, factorId: string, challengeId: string, code: string): Promise<AuthResponse>;
    unenrollFactor(accessToken: string, factorId: string): Promise<{
        error: AuthError | null;
    }>;
    adminListFactors(userId: string): Promise<{
        id: string;
        factor_type: string;
        status: string;
        friendly_name: string | null;
        created_at: string;
    }[]>;
    adminAuditLog(page?: number, perPage?: number): Promise<{
        entries: unknown[];
        total: number;
    }>;
    verifyToken(accessToken: string): Promise<{
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
}
//# sourceMappingURL=handler.d.ts.map