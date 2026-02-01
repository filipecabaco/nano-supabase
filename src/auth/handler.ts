/**
 * Auth handler - processes auth requests and manages auth state
 */

import type { PGlite } from '@electric-sql/pglite'
import type {
  User,
  Session,
  AuthResponse,
  AuthError,
  AuthChangeEvent,
  AuthStateChangeCallback,
  AuthSubscription,
  StoredUser,
  StoredSession,
  StoredRefreshToken,
} from './types.ts'
import { AUTH_SCHEMA_SQL } from './schema.ts'
import {
  createAccessToken,
  verifyAccessToken,
  extractSessionIdFromToken,
} from './crypto.ts'

// Default access token expiry: 1 hour
const ACCESS_TOKEN_EXPIRY = 3600

/**
 * Convert stored user to public user format
 */
function toPublicUser(storedUser: StoredUser): User {
  return {
    id: storedUser.id,
    aud: storedUser.aud,
    role: storedUser.role,
    email: storedUser.email,
    email_confirmed_at: storedUser.email_confirmed_at || undefined,
    phone: storedUser.phone || undefined,
    phone_confirmed_at: storedUser.phone_confirmed_at || undefined,
    confirmed_at: storedUser.email_confirmed_at || storedUser.phone_confirmed_at || undefined,
    last_sign_in_at: storedUser.last_sign_in_at || undefined,
    app_metadata: storedUser.raw_app_meta_data || {},
    user_metadata: storedUser.raw_user_meta_data || {},
    created_at: storedUser.created_at,
    updated_at: storedUser.updated_at,
  }
}

/**
 * Create auth error response
 */
function authError(message: string, status: number, code?: string): AuthError {
  return { message, status, code }
}

/**
 * Auth handler class
 */
export class AuthHandler {
  private db: PGlite
  private initialized = false
  private subscriptions = new Map<string, AuthStateChangeCallback>()
  private currentSession: Session | null = null

  constructor(db: PGlite) {
    this.db = db
  }

  /**
   * Initialize auth schema in the database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.db.exec(AUTH_SCHEMA_SQL)
    this.initialized = true
  }

  /**
   * Emit auth state change to all subscribers
   */
  private emitAuthStateChange(event: AuthChangeEvent, session: Session | null): void {
    this.currentSession = session
    for (const callback of this.subscriptions.values()) {
      try {
        callback(event, session)
      } catch (err) {
        console.error('Auth state change callback error:', err)
      }
    }
  }

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: AuthStateChangeCallback): AuthSubscription {
    const id = crypto.randomUUID()
    this.subscriptions.set(id, callback)

    // Emit initial session state
    setTimeout(() => {
      callback('INITIAL_SESSION', this.currentSession)
    }, 0)

    return {
      id,
      callback,
      unsubscribe: () => {
        this.subscriptions.delete(id)
      },
    }
  }

  /**
   * Sign up a new user
   */
  async signUp(
    email: string,
    password: string,
    options?: { data?: Record<string, unknown> }
  ): Promise<AuthResponse> {
    await this.initialize()

    try {
      // Check if user already exists
      const existingUser = await this.db.query<StoredUser>(
        'SELECT * FROM auth.users WHERE email = $1',
        [email]
      )

      if (existingUser.rows.length > 0) {
        return {
          data: { user: null, session: null },
          error: authError('User already registered', 400, 'user_already_exists'),
        }
      }

      // Create user using database function
      const userMetadata = options?.data ? JSON.stringify(options.data) : '{}'
      const result = await this.db.query<StoredUser>(
        `SELECT * FROM auth.create_user($1, $2, $3::jsonb)`,
        [email, password, userMetadata]
      )

      if (result.rows.length === 0) {
        return {
          data: { user: null, session: null },
          error: authError('Failed to create user', 500, 'user_creation_failed'),
        }
      }

      const storedUser = result.rows[0]
      if (!storedUser) {
        return {
          data: { user: null, session: null },
          error: authError('Failed to create user', 500, 'user_creation_failed'),
        }
      }
      const user = toPublicUser(storedUser)

      // Create session
      const session = await this.createSession(storedUser)

      this.emitAuthStateChange('SIGNED_IN', session)

      return {
        data: { user, session },
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      return {
        data: { user: null, session: null },
        error: authError(message, 500, 'sign_up_failed'),
      }
    }
  }

  /**
   * Sign in with email and password
   */
  async signInWithPassword(
    email: string,
    password: string
  ): Promise<AuthResponse> {
    await this.initialize()

    try {
      // Verify credentials using database function
      const result = await this.db.query<StoredUser>(
        'SELECT * FROM auth.verify_user_credentials($1, $2)',
        [email, password]
      )

      const storedUser = result.rows[0]
      if (!storedUser || !storedUser.id) {
        return {
          data: { user: null, session: null },
          error: authError('Invalid login credentials', 400, 'invalid_credentials'),
        }
      }

      const user = toPublicUser(storedUser)

      // Create session
      const session = await this.createSession(storedUser)

      this.emitAuthStateChange('SIGNED_IN', session)

      return {
        data: { user, session },
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed'
      return {
        data: { user: null, session: null },
        error: authError(message, 500, 'sign_in_failed'),
      }
    }
  }

  /**
   * Create a session for a user
   */
  private async createSession(storedUser: StoredUser): Promise<Session> {
    // Create session in database
    const sessionResult = await this.db.query<StoredSession>(
      'SELECT * FROM auth.create_session($1)',
      [storedUser.id]
    )
    const session = sessionResult.rows[0]
    if (!session) {
      throw new Error('Failed to create session')
    }

    // Create refresh token in database
    const refreshResult = await this.db.query<StoredRefreshToken>(
      'SELECT * FROM auth.create_refresh_token($1, $2)',
      [storedUser.id, session.id]
    )
    const refreshToken = refreshResult.rows[0]
    if (!refreshToken) {
      throw new Error('Failed to create refresh token')
    }

    const user = toPublicUser(storedUser)

    // Generate access token
    const accessToken = await createAccessToken(user, session.id, ACCESS_TOKEN_EXPIRY)

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_EXPIRY,
      expires_at: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY,
      refresh_token: refreshToken.token,
      user,
    }
  }

  /**
   * Refresh the session using a refresh token
   */
  async refreshSession(refreshToken: string): Promise<AuthResponse> {
    await this.initialize()

    try {
      // Use database function to refresh token
      const result = await this.db.query<{
        new_token: string
        user_id: string
        session_id: string
      }>('SELECT * FROM auth.refresh_token($1)', [refreshToken])

      const tokenResult = result.rows[0]
      if (!tokenResult || !tokenResult.new_token) {
        return {
          data: { user: null, session: null },
          error: authError('Invalid refresh token', 401, 'invalid_refresh_token'),
        }
      }

      const { new_token, user_id, session_id } = tokenResult

      // Get user
      const userResult = await this.db.query<StoredUser>(
        'SELECT * FROM auth.users WHERE id = $1',
        [user_id]
      )

      const storedUser = userResult.rows[0]
      if (!storedUser) {
        return {
          data: { user: null, session: null },
          error: authError('User not found', 404, 'user_not_found'),
        }
      }

      const user = toPublicUser(storedUser)

      // Generate new access token
      const accessToken = await createAccessToken(user, session_id, ACCESS_TOKEN_EXPIRY)

      const session: Session = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: ACCESS_TOKEN_EXPIRY,
        expires_at: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY,
        refresh_token: new_token,
        user,
      }

      this.emitAuthStateChange('TOKEN_REFRESHED', session)

      return {
        data: { user, session },
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token refresh failed'
      return {
        data: { user: null, session: null },
        error: authError(message, 500, 'refresh_failed'),
      }
    }
  }

  /**
   * Sign out the current session
   */
  async signOut(accessToken?: string): Promise<{ error: AuthError | null }> {
    await this.initialize()

    try {
      if (accessToken) {
        const sessionId = extractSessionIdFromToken(accessToken)
        if (sessionId) {
          await this.db.query('SELECT auth.sign_out($1::uuid)', [sessionId])
        }
      }

      this.emitAuthStateChange('SIGNED_OUT', null)
      return { error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed'
      return { error: authError(message, 500, 'sign_out_failed') }
    }
  }

  /**
   * Get user from access token
   */
  async getUser(accessToken: string): Promise<{
    data: { user: User | null }
    error: AuthError | null
  }> {
    await this.initialize()

    try {
      const verified = await verifyAccessToken(accessToken)

      if (!verified.valid || !verified.payload) {
        return {
          data: { user: null },
          error: authError(verified.error || 'Invalid token', 401, 'invalid_token'),
        }
      }

      // Get fresh user data from database
      const result = await this.db.query<StoredUser>(
        'SELECT * FROM auth.users WHERE id = $1',
        [verified.payload.sub]
      )

      const storedUser = result.rows[0]
      if (!storedUser) {
        return {
          data: { user: null },
          error: authError('User not found', 404, 'user_not_found'),
        }
      }

      return {
        data: { user: toPublicUser(storedUser) },
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Get user failed'
      return {
        data: { user: null },
        error: authError(message, 500, 'get_user_failed'),
      }
    }
  }

  /**
   * Update user data
   */
  async updateUser(
    accessToken: string,
    attributes: {
      email?: string
      password?: string
      data?: Record<string, unknown>
    }
  ): Promise<AuthResponse> {
    await this.initialize()

    try {
      const verified = await verifyAccessToken(accessToken)

      if (!verified.valid || !verified.payload) {
        return {
          data: { user: null, session: null },
          error: authError(verified.error || 'Invalid token', 401, 'invalid_token'),
        }
      }

      const userId = verified.payload.sub
      const updates: string[] = []
      const params: unknown[] = []
      let paramIndex = 1

      if (attributes.email) {
        updates.push(`email = $${paramIndex}`)
        params.push(attributes.email)
        paramIndex++
      }

      if (attributes.password) {
        updates.push(`encrypted_password = auth.hash_password($${paramIndex})`)
        params.push(attributes.password)
        paramIndex++
      }

      if (attributes.data) {
        updates.push(`raw_user_meta_data = raw_user_meta_data || $${paramIndex}::jsonb`)
        params.push(JSON.stringify(attributes.data))
        paramIndex++
      }

      if (updates.length === 0) {
        // No updates, just return current user
        const result = await this.db.query<StoredUser>(
          'SELECT * FROM auth.users WHERE id = $1',
          [userId]
        )
        const storedUser = result.rows[0]
        if (!storedUser) {
          return {
            data: { user: null, session: null },
            error: authError('User not found', 404, 'user_not_found'),
          }
        }
        return {
          data: { user: toPublicUser(storedUser), session: this.currentSession },
          error: null,
        }
      }

      updates.push('updated_at = NOW()')
      params.push(userId)

      const result = await this.db.query<StoredUser>(
        `UPDATE auth.users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      )

      const storedUser = result.rows[0]
      if (!storedUser) {
        return {
          data: { user: null, session: null },
          error: authError('User not found', 404, 'user_not_found'),
        }
      }

      const user = toPublicUser(storedUser)

      // Update session with new user data if we have a current session
      let session = this.currentSession
      if (session) {
        const newAccessToken = await createAccessToken(
          user,
          verified.payload.session_id,
          ACCESS_TOKEN_EXPIRY
        )
        session = {
          ...session,
          access_token: newAccessToken,
          user,
        }
      }

      this.emitAuthStateChange('USER_UPDATED', session)

      return {
        data: { user, session },
        error: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update user failed'
      return {
        data: { user: null, session: null },
        error: authError(message, 500, 'update_user_failed'),
      }
    }
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.currentSession
  }

  /**
   * Set current session (for restoring from storage)
   */
  setSession(session: Session | null): void {
    this.currentSession = session
    if (session) {
      this.emitAuthStateChange('SIGNED_IN', session)
    }
  }

  /**
   * Verify access token and return payload
   */
  async verifyToken(accessToken: string) {
    return verifyAccessToken(accessToken)
  }
}
