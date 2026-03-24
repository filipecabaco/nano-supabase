/**
 * Auth handler - processes auth requests and manages auth state
 */
import type { PGlite } from "@electric-sql/pglite";
import type { AuthError, AuthResponse, AuthStateChangeCallback, AuthSubscription, Session, User } from "./types.ts";
/**
 * Auth handler class
 */
export declare class AuthHandler {
    private readonly db;
    private initPromise;
    private subscriptions;
    private currentSession;
    constructor(db: PGlite);
    initialize(): Promise<void>;
    /**
     * Emit auth state change to all subscribers
     */
    private emitAuthStateChange;
    /**
     * Subscribe to auth state changes
     */
    onAuthStateChange(callback: AuthStateChangeCallback): AuthSubscription;
    private signInAndCreateSession;
    /**
     * Sign up a new user
     */
    signUp(email: string, password: string, options?: {
        data?: Record<string, unknown>;
    }): Promise<AuthResponse>;
    /**
     * Sign in with email and password
     */
    signInWithPassword(email: string, password: string): Promise<AuthResponse>;
    /**
     * Create a session for a user
     */
    private createSession;
    /**
     * Refresh the session using a refresh token
     */
    refreshSession(refreshToken: string): Promise<AuthResponse>;
    /**
     * Sign out the current session
     */
    signOut(accessToken?: string): Promise<{
        error: AuthError | null;
    }>;
    /**
     * Get user from access token
     */
    getUser(accessToken: string): Promise<{
        data: {
            user: User | null;
        };
        error: AuthError | null;
    }>;
    /**
     * Update user data
     */
    updateUser(accessToken: string, attributes: {
        email?: string;
        password?: string;
        data?: Record<string, unknown>;
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
    /**
     * Get current session
     */
    getSession(): Session | null;
    /**
     * Set current session (for restoring from storage)
     */
    setSession(session: Session | null): void;
    /**
     * Verify access token and return payload
     */
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