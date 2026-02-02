/**
 * Auth handler - processes auth requests and manages auth state
 */
import type { PGlite } from '@electric-sql/pglite';
import type { User, Session, AuthResponse, AuthError, AuthStateChangeCallback, AuthSubscription } from './types.ts';
/**
 * Auth handler class
 */
export declare class AuthHandler {
    private db;
    private initialized;
    private subscriptions;
    private currentSession;
    constructor(db: PGlite);
    /**
     * Initialize auth schema in the database
     */
    initialize(): Promise<void>;
    /**
     * Emit auth state change to all subscribers
     */
    private emitAuthStateChange;
    /**
     * Subscribe to auth state changes
     */
    onAuthStateChange(callback: AuthStateChangeCallback): AuthSubscription;
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