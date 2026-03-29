import type { PGliteInterface } from "@electric-sql/pglite";
import {
  createAccessToken,
  extractSessionIdFromToken,
  verifyAccessToken,
} from "./crypto.ts";
import { AUTH_SCHEMA_SQL } from "./schema.ts";
import type {
  AuthChangeEvent,
  AuthError,
  AuthResponse,
  AuthStateChangeCallback,
  AuthSubscription,
  Session,
  StoredRefreshToken,
  StoredSession,
  StoredUser,
  User,
} from "./types.ts";

const ACCESS_TOKEN_EXPIRY_SECONDS = 3600;

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toPublicUser(storedUser: StoredUser): User {
  return {
    id: storedUser.id,
    aud: storedUser.aud,
    role: storedUser.role,
    email: storedUser.email,
    email_confirmed_at: storedUser.email_confirmed_at || undefined,
    phone: storedUser.phone || undefined,
    phone_confirmed_at: storedUser.phone_confirmed_at || undefined,
    confirmed_at:
      storedUser.email_confirmed_at ||
      storedUser.phone_confirmed_at ||
      undefined,
    last_sign_in_at: storedUser.last_sign_in_at || undefined,
    app_metadata: storedUser.raw_app_meta_data || {},
    user_metadata: storedUser.raw_user_meta_data || {},
    created_at: storedUser.created_at,
    updated_at: storedUser.updated_at,
  };
}

function authError(message: string, status: number, code?: string): AuthError {
  return { message, status, code };
}

function fail(message: string, status: number, code?: string): AuthResponse {
  return {
    data: { user: null, session: null },
    error: authError(message, status, code),
  };
}

export class AuthHandler {
  private readonly db: PGliteInterface;
  private initPromise: Promise<unknown> | null = null;
  private subscriptions = new Map<string, AuthStateChangeCallback>();
  private currentSession: Session | null = null;

  constructor(db: PGliteInterface) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    this.initPromise ??= this.db.exec(AUTH_SCHEMA_SQL);
    await this.initPromise;
  }

  private emitAuthStateChange(
    event: AuthChangeEvent,
    session: Session | null,
  ): void {
    this.currentSession = session;
    for (const callback of this.subscriptions.values()) {
      try {
        callback(event, session);
      } catch (err) {
        console.error("Auth state change callback error:", err);
      }
    }
  }

  onAuthStateChange(callback: AuthStateChangeCallback): AuthSubscription {
    const id = crypto.randomUUID();
    this.subscriptions.set(id, callback);

    queueMicrotask(() => {
      callback("INITIAL_SESSION", this.currentSession);
    });

    return {
      id,
      callback,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  private async signInAndCreateSession(
    storedUser: StoredUser,
  ): Promise<AuthResponse> {
    const user = toPublicUser(storedUser);
    const session = await this.createSession(storedUser);
    this.emitAuthStateChange("SIGNED_IN", session);
    return { data: { user, session }, error: null };
  }

  async signUp(
    email: string,
    password: string,
    options?: { data?: Record<string, unknown> },
  ): Promise<AuthResponse> {
    await this.initialize();

    await this.db.exec("RESET ROLE");

    try {
      const existingUser = await this.db.query<StoredUser>(
        "SELECT * FROM auth.users WHERE email = $1",
        [email],
      );

      if (existingUser.rows.length > 0) {
        return fail("User already registered", 400, "user_already_exists");
      }

      const userMetadata = options?.data ? JSON.stringify(options.data) : "{}";
      const result = await this.db.query<StoredUser>(
        `SELECT * FROM auth.create_user($1, $2, $3::jsonb)`,
        [email, password, userMetadata],
      );

      const storedUser = result.rows[0];
      if (!storedUser) {
        return fail("Failed to create user", 500, "user_creation_failed");
      }

      await this.writeAuditLog("signup", storedUser.id, email, "account");
      return this.signInAndCreateSession(storedUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign up failed";
      return fail(message, 500, "sign_up_failed");
    }
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<AuthResponse> {
    await this.initialize();

    await this.db.exec("RESET ROLE");

    try {
      const result = await this.db.query<StoredUser>(
        "SELECT * FROM auth.verify_user_credentials($1, $2)",
        [email, password],
      );

      const storedUser = result.rows[0];
      if (!storedUser || !storedUser.id) {
        await this.writeAuditLog("login_failed", null, email, "account");
        return fail("Invalid login credentials", 400, "invalid_credentials");
      }

      await this.writeAuditLog(
        "login",
        storedUser.id,
        storedUser.email,
        "account",
      );
      return this.signInAndCreateSession(storedUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      return fail(message, 500, "sign_in_failed");
    }
  }

  private async createSession(storedUser: StoredUser): Promise<Session> {
    const sessionResult = await this.db.query<StoredSession>(
      "SELECT * FROM auth.create_session($1)",
      [storedUser.id],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new Error("Failed to create session");
    }

    const refreshResult = await this.db.query<StoredRefreshToken>(
      "SELECT * FROM auth.create_refresh_token($1, $2)",
      [storedUser.id, session.id],
    );
    const refreshToken = refreshResult.rows[0];
    if (!refreshToken) {
      throw new Error("Failed to create refresh token");
    }

    const user = toPublicUser(storedUser);

    const accessToken = await createAccessToken(
      this.db,
      user,
      session.id,
      ACCESS_TOKEN_EXPIRY_SECONDS,
    );

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
      expires_at: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SECONDS,
      refresh_token: refreshToken.token,
      user,
    };
  }

  async refreshSession(refreshToken: string): Promise<AuthResponse> {
    await this.initialize();

    try {
      const result = await this.db.query<{
        new_token: string;
        user_id: string;
        session_id: string;
      }>("SELECT * FROM auth.refresh_token($1)", [refreshToken]);

      const tokenResult = result.rows[0];
      if (!tokenResult || !tokenResult.new_token) {
        return fail("Invalid refresh token", 401, "invalid_refresh_token");
      }

      const { new_token, user_id, session_id } = tokenResult;

      const userResult = await this.db.query<StoredUser>(
        "SELECT * FROM auth.users WHERE id = $1",
        [user_id],
      );

      const storedUser = userResult.rows[0];
      if (!storedUser) {
        return fail("User not found", 404, "user_not_found");
      }

      const user = toPublicUser(storedUser);

      const accessToken = await createAccessToken(
        this.db,
        user,
        session_id,
        ACCESS_TOKEN_EXPIRY_SECONDS,
      );

      const session: Session = {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
        expires_at: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SECONDS,
        refresh_token: new_token,
        user,
      };

      this.emitAuthStateChange("TOKEN_REFRESHED", session);

      return {
        data: { user, session },
        error: null,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Token refresh failed";
      return fail(message, 500, "refresh_failed");
    }
  }

  async signOut(accessToken?: string): Promise<{ error: AuthError | null }> {
    await this.initialize();

    try {
      let signOutUserId: string | null = null;
      if (accessToken) {
        const sessionId = extractSessionIdFromToken(accessToken);
        if (sessionId) {
          try {
            const uidResult = await this.db.query<{ user_id: string }>(
              "SELECT user_id FROM auth.sessions WHERE id = $1::uuid",
              [sessionId],
            );
            signOutUserId = uidResult.rows[0]?.user_id ?? null;
          } catch {}
          await this.db.query("SELECT auth.sign_out($1::uuid)", [sessionId]);
        }
      }

      await this.db.exec("RESET ROLE");

      if (signOutUserId)
        await this.writeAuditLog("logout", signOutUserId, null, "account");

      this.emitAuthStateChange("SIGNED_OUT", null);
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign out failed";
      return { error: authError(message, 500, "sign_out_failed") };
    }
  }

  async getUser(accessToken: string): Promise<{
    data: { user: User | null };
    error: AuthError | null;
  }> {
    await this.initialize();

    try {
      const verified = await verifyAccessToken(this.db, accessToken);

      if (!verified.valid || !verified.payload) {
        return {
          data: { user: null },
          error: authError(
            verified.error || "Invalid token",
            401,
            "invalid_token",
          ),
        };
      }

      const result = await this.db.query<StoredUser>(
        "SELECT * FROM auth.users WHERE id = $1",
        [verified.payload.sub],
      );

      const storedUser = result.rows[0];
      if (!storedUser) {
        return {
          data: { user: null },
          error: authError("User not found", 404, "user_not_found"),
        };
      }

      return {
        data: { user: toPublicUser(storedUser) },
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Get user failed";
      return {
        data: { user: null },
        error: authError(message, 500, "get_user_failed"),
      };
    }
  }

  private async verifyNonce(
    userId: string,
    nonce: string,
  ): Promise<AuthResponse | null> {
    const nonceCheck = await this.db.query<{
      reauthentication_token: string | null;
      reauthentication_sent_at: string | null;
    }>(
      "SELECT reauthentication_token, reauthentication_sent_at FROM auth.users WHERE id = $1",
      [userId],
    );
    const stored = nonceCheck.rows[0]?.reauthentication_token;
    if (
      !stored ||
      stored.length !== nonce.length ||
      !constantTimeCompare(stored, nonce)
    ) {
      return fail("Invalid nonce", 422, "invalid_nonce");
    }
    const sentAt = new Date(
      nonceCheck.rows[0]?.reauthentication_sent_at ?? 0,
    ).getTime();
    if (Date.now() - sentAt > 10 * 60 * 1000) {
      return fail("Reauthentication token expired", 401, "nonce_expired");
    }
    await this.db.query(
      "UPDATE auth.users SET reauthentication_token = NULL, updated_at = NOW() WHERE id = $1",
      [userId],
    );
    return null;
  }

  async updateUser(
    accessToken: string,
    attributes: {
      email?: string;
      password?: string;
      data?: Record<string, unknown>;
      nonce?: string;
    },
  ): Promise<AuthResponse> {
    await this.initialize();

    try {
      const verified = await verifyAccessToken(this.db, accessToken);

      if (!verified.valid || !verified.payload) {
        return fail(verified.error || "Invalid token", 401, "invalid_token");
      }

      const userId = verified.payload.sub;

      if (attributes.nonce !== undefined) {
        const nonceError = await this.verifyNonce(userId, attributes.nonce);
        if (nonceError) return nonceError;
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (attributes.email) {
        updates.push(`email = $${paramIndex}`);
        params.push(attributes.email);
        paramIndex++;
      }

      if (attributes.password) {
        updates.push(`encrypted_password = auth.hash_password($${paramIndex})`);
        params.push(attributes.password);
        paramIndex++;
      }

      if (attributes.data) {
        updates.push(
          `raw_user_meta_data = raw_user_meta_data || $${paramIndex}::jsonb`,
        );
        params.push(JSON.stringify(attributes.data));
        paramIndex++;
      }

      if (updates.length === 0) {
        const result = await this.db.query<StoredUser>(
          "SELECT * FROM auth.users WHERE id = $1",
          [userId],
        );
        const storedUser = result.rows[0];
        if (!storedUser) {
          return fail("User not found", 404, "user_not_found");
        }
        return {
          data: {
            user: toPublicUser(storedUser),
            session: this.currentSession,
          },
          error: null,
        };
      }

      updates.push("updated_at = NOW()");
      params.push(userId);

      const result = await this.db.query<StoredUser>(
        `UPDATE auth.users SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        params,
      );

      const storedUser = result.rows[0];
      if (!storedUser) {
        return fail("User not found", 404, "user_not_found");
      }

      const user = toPublicUser(storedUser);

      let session = this.currentSession;
      if (session) {
        const newAccessToken = await createAccessToken(
          this.db,
          user,
          verified.payload.session_id,
          ACCESS_TOKEN_EXPIRY_SECONDS,
        );
        session = {
          ...session,
          access_token: newAccessToken,
          user,
        };
      }

      this.emitAuthStateChange("USER_UPDATED", session);

      return {
        data: { user, session },
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update user failed";
      return fail(message, 500, "update_user_failed");
    }
  }

  async adminListUsers(
    page = 1,
    perPage = 50,
  ): Promise<{ users: User[]; total: number }> {
    await this.initialize();
    const offset = (page - 1) * perPage;
    const [rows, countRows] = await Promise.all([
      this.db.query<StoredUser>(
        "SELECT * FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [perPage, offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM auth.users",
      ),
    ]);
    return {
      users: rows.rows.map(toPublicUser),
      total: countRows.rows[0]?.total ?? 0,
    };
  }

  async adminGetUser(id: string): Promise<User | null> {
    await this.initialize();
    const result = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE id = $1",
      [id],
    );
    const user = result.rows[0];
    return user ? toPublicUser(user) : null;
  }

  async adminCreateUser(attrs: {
    email?: string;
    phone?: string;
    password?: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  }): Promise<User> {
    await this.initialize();
    const userMetadata = JSON.stringify(attrs.user_metadata ?? {});
    const appMetadata = JSON.stringify(attrs.app_metadata ?? {});
    const confirmed = attrs.email_confirm !== false ? "NOW()" : "NULL";
    const result = await this.db.query<StoredUser>(
      `INSERT INTO auth.users (email, phone, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, confirmed_at, aud, role)
       VALUES ($1, $2, COALESCE(auth.hash_password($3), ''), $4::jsonb, $5::jsonb, ${confirmed}, ${confirmed}, 'authenticated', 'authenticated')
       RETURNING *`,
      [
        attrs.email ?? null,
        attrs.phone ?? null,
        attrs.password ?? null,
        userMetadata,
        appMetadata,
      ],
    );
    const user = result.rows[0];
    if (!user) throw new Error("Failed to create user");
    return toPublicUser(user);
  }

  async adminUpdateUser(
    id: string,
    attrs: {
      email?: string;
      phone?: string;
      password?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
      ban_duration?: string;
      email_confirm?: boolean;
    },
  ): Promise<User | null> {
    await this.initialize();
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;
    if (attrs.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(attrs.email);
    }
    if (attrs.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      params.push(attrs.phone);
    }
    if (attrs.password) {
      updates.push(`encrypted_password = auth.hash_password($${paramIndex++})`);
      params.push(attrs.password);
    }
    if (attrs.user_metadata !== undefined) {
      updates.push(
        `raw_user_meta_data = raw_user_meta_data || $${paramIndex++}::jsonb`,
      );
      params.push(JSON.stringify(attrs.user_metadata));
    }
    if (attrs.app_metadata !== undefined) {
      updates.push(
        `raw_app_meta_data = raw_app_meta_data || $${paramIndex++}::jsonb`,
      );
      params.push(JSON.stringify(attrs.app_metadata));
    }
    if (attrs.ban_duration === "none") {
      updates.push("banned_until = NULL");
    } else if (attrs.ban_duration) {
      updates.push(`banned_until = NOW() + $${paramIndex++}::interval`);
      params.push(attrs.ban_duration);
    }
    if (attrs.email_confirm) {
      updates.push("email_confirmed_at = COALESCE(email_confirmed_at, NOW())");
    }
    if (updates.length === 0) return this.adminGetUser(id);
    updates.push("updated_at = NOW()");
    params.push(id);
    const result = await this.db.query<StoredUser>(
      `UPDATE auth.users SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      params,
    );
    const user = result.rows[0];
    return user ? toPublicUser(user) : null;
  }

  async adminDeleteUser(id: string): Promise<void> {
    await this.initialize();
    await this.db.query("DELETE FROM auth.users WHERE id = $1", [id]);
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  setSession(session: Session | null): void {
    this.currentSession = session;
    if (session) {
      this.emitAuthStateChange("SIGNED_IN", session);
    }
  }

  private async writeAuditLog(
    action: string,
    actorId: string | null,
    actorEmail: string | null,
    logType: string,
  ): Promise<void> {
    try {
      const payload = JSON.stringify({
        action,
        actor_id: actorId,
        actor_username: actorEmail,
        log_type: logType,
      });
      await this.db.query(
        "INSERT INTO auth.audit_log_entries (id, payload, created_at, ip_address) VALUES (gen_random_uuid(), $1::json, NOW(), '')",
        [payload],
      );
    } catch {}
  }

  private async generateOneTimeToken(
    userId: string,
    tokenType: string,
    relatesTo: string,
  ): Promise<string> {
    const rawBytes = crypto.getRandomValues(new Uint8Array(32));
    const rawToken = bytesToHex(rawBytes);
    const hashBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken),
    );
    const tokenHash = bytesToHex(new Uint8Array(hashBytes));
    await this.db.query(
      "DELETE FROM auth.one_time_tokens WHERE expires_at < NOW()",
    );
    await this.db.query(
      "DELETE FROM auth.one_time_tokens WHERE user_id = $1 AND token_type = $2",
      [userId, tokenType],
    );
    await this.db.query(
      "INSERT INTO auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, expires_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + INTERVAL '10 minutes')",
      [userId, tokenType, tokenHash, relatesTo],
    );
    return rawToken;
  }

  private async consumeOneTimeToken(
    rawToken: string,
    tokenType: string,
  ): Promise<{ userId: string; relatesTo: string } | null> {
    const hashBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken),
    );
    const tokenHash = bytesToHex(new Uint8Array(hashBytes));
    const result = await this.db.query<{
      user_id: string;
      relates_to: string;
      token_type: string;
    }>(
      "DELETE FROM auth.one_time_tokens WHERE token_hash = $1 AND token_type = $2 AND expires_at > NOW() RETURNING user_id, relates_to, token_type",
      [tokenHash, tokenType],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { userId: row.user_id, relatesTo: row.relates_to };
  }

  async signInAnonymously(): Promise<AuthResponse> {
    await this.initialize();
    await this.db.exec("RESET ROLE");
    try {
      const result = await this.db.query<StoredUser>(
        "INSERT INTO auth.users (aud, role, is_anonymous, email_confirmed_at, confirmed_at, created_at, updated_at) VALUES ('authenticated', 'authenticated', true, NOW(), NOW(), NOW(), NOW()) RETURNING *",
      );
      const storedUser = result.rows[0];
      if (!storedUser) {
        return fail(
          "Failed to create anonymous user",
          500,
          "anonymous_sign_in_failed",
        );
      }
      return this.signInAndCreateSession(storedUser);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Anonymous sign in failed";
      return fail(message, 500, "anonymous_sign_in_failed");
    }
  }

  async sendOtp(email: string): Promise<{ token: string }> {
    await this.initialize();
    const userResult = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE email = $1",
      [email],
    );
    let storedUser = userResult.rows[0];
    if (!storedUser) {
      const created = await this.db.query<StoredUser>(
        "INSERT INTO auth.users (email, aud, role, created_at, updated_at) VALUES ($1, 'authenticated', 'authenticated', NOW(), NOW()) RETURNING *",
        [email],
      );
      storedUser = created.rows[0];
      if (!storedUser) throw new Error("Failed to create user for OTP");
    }
    const token = await this.generateOneTimeToken(
      storedUser.id,
      "magiclink",
      email,
    );
    return { token };
  }

  async sendRecovery(email: string): Promise<{ token: string | null }> {
    await this.initialize();
    const userResult = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE email = $1",
      [email],
    );
    const storedUser = userResult.rows[0];
    if (!storedUser) return { token: null };
    const token = await this.generateOneTimeToken(
      storedUser.id,
      "recovery",
      email,
    );
    return { token };
  }

  async verifyOtp(rawToken: string, type: string): Promise<AuthResponse> {
    await this.initialize();
    const tokenType =
      type === "recovery"
        ? "recovery"
        : type === "invite"
          ? "invite"
          : "magiclink";
    const consumed = await this.consumeOneTimeToken(rawToken, tokenType);
    if (!consumed) {
      return fail("Token has expired or is invalid", 403, "otp_expired");
    }
    const userResult = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE id = $1",
      [consumed.userId],
    );
    const storedUser = userResult.rows[0];
    if (!storedUser) {
      return fail("User not found", 404, "user_not_found");
    }
    if (!storedUser.email_confirmed_at) {
      const updated = await this.db.query<StoredUser>(
        "UPDATE auth.users SET email_confirmed_at = NOW(), confirmed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
        [storedUser.id],
      );
      const user = updated.rows[0];
      if (!user)
        return fail("User not found after update", 500, "internal_error");
      return this.signInAndCreateSession(user);
    }
    return this.signInAndCreateSession(storedUser);
  }

  async sendInvite(email: string): Promise<{ token: string }> {
    await this.initialize();
    const existing = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE email = $1",
      [email],
    );
    let storedUser = existing.rows[0];
    if (!storedUser) {
      const created = await this.db.query<StoredUser>(
        "INSERT INTO auth.users (email, aud, role, invited_at, created_at, updated_at) VALUES ($1, 'authenticated', 'authenticated', NOW(), NOW(), NOW()) RETURNING *",
        [email],
      );
      storedUser = created.rows[0];
      if (!storedUser) throw new Error("Failed to create user for invite");
    }
    const token = await this.generateOneTimeToken(
      storedUser.id,
      "invite",
      email,
    );
    return { token };
  }

  async reauthenticate(
    accessToken: string,
  ): Promise<{ error: AuthError | null }> {
    await this.initialize();
    const verified = await verifyAccessToken(this.db, accessToken);
    if (!verified.valid || !verified.payload) {
      return {
        error: authError(
          verified.error || "Invalid token",
          401,
          "invalid_token",
        ),
      };
    }
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const nonce = bytesToHex(nonceBytes);
    await this.db.query(
      "UPDATE auth.users SET reauthentication_token = $1, reauthentication_sent_at = NOW(), updated_at = NOW() WHERE id = $2",
      [nonce, verified.payload.sub],
    );
    return { error: null };
  }

  async enrollTOTP(
    accessToken: string,
    friendlyName?: string,
  ): Promise<{
    id: string;
    type: string;
    totp: { qr_code: string; secret: string; uri: string };
  } | null> {
    await this.initialize();
    const verified = await verifyAccessToken(this.db, accessToken);
    if (!verified.valid || !verified.payload) return null;
    const secretBytes = crypto.getRandomValues(new Uint8Array(20));
    const { base32 } = await import("@scure/base");
    const secretBase32 = base32.encode(secretBytes);
    const factorId = crypto.randomUUID();
    const issuer = "nano-supabase";
    const email = verified.payload.email || verified.payload.sub;
    const uri =
      "otpauth://totp/" +
      issuer +
      ":" +
      email +
      "?secret=" +
      secretBase32 +
      "&issuer=" +
      issuer +
      "&algorithm=SHA1&digits=6&period=30";
    const qrCode =
      "data:image/svg+xml;base64," +
      btoa(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>' +
          uri +
          "</text></svg>",
      );
    await this.db.query(
      "INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) VALUES ($1, $2, $3, 'totp', 'unverified', $4, NOW(), NOW())",
      [factorId, verified.payload.sub, friendlyName ?? null, secretBase32],
    );
    return {
      id: factorId,
      type: "totp",
      totp: { qr_code: qrCode, secret: secretBase32, uri },
    };
  }

  async challengeTOTP(
    accessToken: string,
    factorId: string,
  ): Promise<{ id: string; expires_at: number } | null> {
    await this.initialize();
    const verified = await verifyAccessToken(this.db, accessToken);
    if (!verified.valid || !verified.payload) return null;
    const factorResult = await this.db.query<{ id: string }>(
      "SELECT id FROM auth.mfa_factors WHERE id = $1 AND user_id = $2",
      [factorId, verified.payload.sub],
    );
    if (!factorResult.rows[0]) return null;
    const challengeId = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    await this.db.query(
      "INSERT INTO auth.mfa_challenges (id, factor_id, created_at, ip_address) VALUES ($1, $2, NOW(), '127.0.0.1'::inet)",
      [challengeId, factorId],
    );
    return { id: challengeId, expires_at: expiresAt };
  }

  async verifyTOTP(
    accessToken: string,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<AuthResponse> {
    await this.initialize();
    const verified = await verifyAccessToken(this.db, accessToken);
    if (!verified.valid || !verified.payload) {
      return fail("Invalid token", 401, "invalid_token");
    }
    const challengeResult = await this.db.query<{
      id: string;
      created_at: string;
      verified_at: string | null;
    }>(
      "SELECT id, created_at, verified_at FROM auth.mfa_challenges WHERE id = $1 AND factor_id = $2",
      [challengeId, factorId],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.verified_at) {
      return fail("Invalid or expired challenge", 400, "challenge_expired");
    }
    const challengeAge = Date.now() - new Date(challenge.created_at).getTime();
    if (challengeAge > 300000) {
      return fail("Challenge expired", 400, "challenge_expired");
    }
    const factorResult = await this.db.query<{ secret: string }>(
      "SELECT secret FROM auth.mfa_factors WHERE id = $1 AND user_id = $2",
      [factorId, verified.payload.sub],
    );
    const factor = factorResult.rows[0];
    if (!factor) {
      return fail("Factor not found", 404, "factor_not_found");
    }
    const { base32 } = await import("@scure/base");
    const { verifyTOTP: verifyTOTPCode } = await import("@oslojs/otp");
    const secretBytes = base32.decode(factor.secret);
    const valid = verifyTOTPCode(secretBytes, 30, 6, code);
    if (!valid) {
      return fail("Invalid TOTP code", 422, "invalid_totp_code");
    }
    await this.db.query(
      "UPDATE auth.mfa_challenges SET verified_at = NOW() WHERE id = $1",
      [challengeId],
    );
    await this.db.query(
      "UPDATE auth.mfa_factors SET status = 'verified', updated_at = NOW() WHERE id = $1",
      [factorId],
    );
    const userResult = await this.db.query<StoredUser>(
      "SELECT * FROM auth.users WHERE id = $1",
      [verified.payload.sub],
    );
    const storedUser = userResult.rows[0];
    if (!storedUser) {
      return fail("User not found", 404, "user_not_found");
    }
    return this.signInAndCreateSession(storedUser);
  }

  async unenrollFactor(
    accessToken: string,
    factorId: string,
  ): Promise<{ error: AuthError | null }> {
    await this.initialize();
    const verified = await verifyAccessToken(this.db, accessToken);
    if (!verified.valid || !verified.payload) {
      return { error: authError("Invalid token", 401, "invalid_token") };
    }
    await this.db.query(
      "DELETE FROM auth.mfa_factors WHERE id = $1 AND user_id = $2",
      [factorId, verified.payload.sub],
    );
    return { error: null };
  }

  async adminListFactors(userId: string): Promise<
    {
      id: string;
      factor_type: string;
      status: string;
      friendly_name: string | null;
      created_at: string;
    }[]
  > {
    await this.initialize();
    const result = await this.db.query<{
      id: string;
      factor_type: string;
      status: string;
      friendly_name: string | null;
      created_at: string;
    }>(
      "SELECT id, factor_type, status, friendly_name, created_at FROM auth.mfa_factors WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    return result.rows;
  }

  async adminAuditLog(
    page = 1,
    perPage = 50,
  ): Promise<{ entries: unknown[]; total: number }> {
    await this.initialize();
    const offset = (page - 1) * perPage;
    const [rows, countRows] = await Promise.all([
      this.db.query<{
        id: string;
        payload: unknown;
        created_at: string;
        ip_address: string;
      }>(
        "SELECT id, payload, created_at, ip_address FROM auth.audit_log_entries ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [perPage, offset],
      ),
      this.db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM auth.audit_log_entries",
      ),
    ]);
    return { entries: rows.rows, total: countRows.rows[0]?.total ?? 0 };
  }

  async verifyToken(accessToken: string): Promise<{
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
  }> {
    return verifyAccessToken(this.db, accessToken);
  }
}
