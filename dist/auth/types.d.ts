/**
 * Auth types compatible with Supabase Auth (GoTrue)
 */
/**
 * User object returned from auth operations
 */
export interface User {
    id: string;
    aud: string;
    role: string;
    email?: string;
    email_confirmed_at?: string;
    phone?: string;
    phone_confirmed_at?: string;
    confirmed_at?: string;
    last_sign_in_at?: string;
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
    identities?: UserIdentity[];
    created_at: string;
    updated_at: string;
}
/**
 * User identity (for OAuth providers)
 */
export interface UserIdentity {
    id: string;
    user_id: string;
    identity_data: Record<string, unknown>;
    provider: string;
    last_sign_in_at?: string;
    created_at: string;
    updated_at: string;
}
/**
 * Session object containing tokens and user
 */
export interface Session {
    access_token: string;
    token_type: "bearer";
    expires_in: number;
    expires_at: number;
    refresh_token: string;
    user: User;
}
/**
 * Auth response for sign up/sign in operations
 */
export interface AuthResponse {
    data: {
        user: User | null;
        session: Session | null;
    };
    error: AuthError | null;
}
/**
 * Auth error object
 */
export interface AuthError {
    message: string;
    status: number;
    code?: string;
}
/**
 * Sign up credentials
 */
export interface SignUpCredentials {
    email: string;
    password: string;
    options?: {
        data?: Record<string, unknown>;
        emailRedirectTo?: string;
    };
}
/**
 * Sign in credentials
 */
export interface SignInCredentials {
    email: string;
    password: string;
}
/**
 * Auth state change event types
 */
export type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED" | "PASSWORD_RECOVERY";
/**
 * Auth state change callback
 */
export type AuthStateChangeCallback = (event: AuthChangeEvent, session: Session | null) => void;
/**
 * Subscription returned from onAuthStateChange
 */
export interface AuthSubscription {
    id: string;
    callback: AuthStateChangeCallback;
    unsubscribe: () => void;
}
/**
 * Internal user record stored in database
 */
export interface StoredUser {
    id: string;
    instance_id: string;
    aud: string;
    role: string;
    email: string;
    encrypted_password: string;
    email_confirmed_at: string | null;
    invited_at: string | null;
    confirmation_token: string | null;
    confirmation_sent_at: string | null;
    recovery_token: string | null;
    recovery_sent_at: string | null;
    email_change_token_new: string | null;
    email_change: string | null;
    email_change_sent_at: string | null;
    last_sign_in_at: string | null;
    raw_app_meta_data: Record<string, unknown>;
    raw_user_meta_data: Record<string, unknown>;
    is_super_admin: boolean;
    created_at: string;
    updated_at: string;
    phone: string | null;
    phone_confirmed_at: string | null;
    phone_change: string | null;
    phone_change_token: string | null;
    phone_change_sent_at: string | null;
    banned_until: string | null;
    reauthentication_token: string | null;
    reauthentication_sent_at: string | null;
    is_sso_user: boolean;
    deleted_at: string | null;
}
/**
 * Internal session record stored in database
 */
export interface StoredSession {
    id: string;
    user_id: string;
    created_at: string;
    updated_at: string;
    factor_id: string | null;
    aal: string;
    not_after: string | null;
    refreshed_at: string | null;
    user_agent: string | null;
    ip: string | null;
    tag: string | null;
}
/**
 * Internal refresh token record stored in database
 */
export interface StoredRefreshToken {
    id: number;
    token: string;
    user_id: string;
    revoked: boolean;
    created_at: string;
    updated_at: string;
    parent: string | null;
    session_id: string;
}
/**
 * Token pair (access + refresh)
 */
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt: number;
}
//# sourceMappingURL=types.d.ts.map