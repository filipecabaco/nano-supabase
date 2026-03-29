import type { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { createFetchAdapter } from "../src/client.ts";
import { createPGlite } from "../src/pglite-factory.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  describe,
  test,
} from "./compat.ts";

async function createTestClient(db?: PGlite) {
  const dbInstance = db || createPGlite();
  const { localFetch, authHandler } = await createFetchAdapter({
    db: dbInstance,
    serviceRoleKey: "local-service-role-key",
  });
  const supabase = createClient("http://localhost:54321", "local-anon-key", {
    auth: { autoRefreshToken: false },
    global: { fetch: localFetch },
  });
  return { supabase, authHandler, db: dbInstance, localFetch };
}

// ============================================================================
// 1. Anonymous Sign-in
// ============================================================================

describe("Anonymous Sign-in", () => {
  test("signInAnonymously returns a valid session", async () => {
    const db = createPGlite();
    const { supabase } = await createTestClient(db);

    const result = await supabase.auth.signInAnonymously();

    assertEquals(result.error, null);
    assertExists(result.data.session);
    assertExists(result.data.session?.access_token);
    assertExists(result.data.user);
    assertExists(result.data.user?.id);

    await db.close();
  });

  test("anonymous user has is_anonymous flag in database", async () => {
    const db = createPGlite();
    const { supabase, authHandler } = await createTestClient(db);

    await authHandler.initialize();
    const result = await supabase.auth.signInAnonymously();
    const userId = result.data.user?.id;
    assertExists(userId);

    const row = await db.query<{ is_anonymous: boolean }>(
      "SELECT is_anonymous FROM auth.users WHERE id = $1",
      [userId],
    );
    assertEquals(row.rows[0]?.is_anonymous, true);

    await db.close();
  });

  test("anonymous user can query with RLS via auth.uid()", async () => {
    const db = createPGlite();
    const { supabase } = await createTestClient(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL DEFAULT auth.uid(),
        content TEXT
      );
      ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "own notes" ON notes;
      CREATE POLICY "own notes" ON notes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
      GRANT ALL ON notes TO authenticated;
    `);

    const signIn = await supabase.auth.signInAnonymously();
    assertEquals(signIn.error, null);
    const userId = signIn.data.user?.id;

    const insert = await supabase
      .from("notes")
      .insert({ content: "hello" })
      .select();
    assertEquals(insert.error, null);
    assertEquals(insert.data?.[0]?.user_id, userId);

    await db.close();
  });

  test("two anonymous users are isolated from each other", async () => {
    const db = createPGlite();
    const { supabase: c1 } = await createTestClient(db);
    const { supabase: c2 } = await createTestClient(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL DEFAULT auth.uid(),
        label TEXT
      );
      ALTER TABLE items ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "own items" ON items;
      CREATE POLICY "own items" ON items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
      GRANT ALL ON items TO authenticated;
    `);

    await c1.auth.signInAnonymously();
    await c1.from("items").insert({ label: "c1 item" });

    await c2.auth.signInAnonymously();
    const c2Items = await c2.from("items").select("*");
    assertEquals(c2Items.data?.length, 0);

    await db.close();
  });
});

// ============================================================================
// 2. OTP / Magic Link
// ============================================================================

describe("OTP / Magic Link", () => {
  test("POST /auth/v1/otp for existing user returns 200 and a token", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "otp@example.com",
      password: "password123",
    });
    await supabase.auth.signOut();

    const res = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "otp@example.com" }),
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token?: string };
    assertExists(body.token);

    await db.close();
  });

  test("GET /auth/v1/verify with magiclink token returns valid session", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "magic@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const otpRes = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "magic@example.com" }),
    });
    const { token } = (await otpRes.json()) as { token: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        token +
        "&type=magiclink",
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as {
      access_token?: string;
      user?: { email: string };
    };
    assertExists(session.access_token);
    assertEquals(session.user?.email, "magic@example.com");

    await db.close();
  });

  test("POST /auth/v1/verify with magiclink token returns valid session", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "magic2@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const otpRes = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "magic2@example.com" }),
    });
    const { token } = (await otpRes.json()) as { token: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          type: "magiclink",
          email: "magic2@example.com",
        }),
      },
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as { access_token?: string };
    assertExists(session.access_token);

    await db.close();
  });

  test("magic link token is single-use", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "single@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const otpRes = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "single@example.com" }),
    });
    const { token } = (await otpRes.json()) as { token: string };

    await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        token +
        "&type=magiclink",
    );

    const secondRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        token +
        "&type=magiclink",
    );
    assertNotEquals(secondRes.status, 200);

    await db.close();
  });

  test("expired token returns error", async () => {
    const db = createPGlite();
    const { supabase, authHandler, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "expired@example.com",
      password: "pass",
    });
    await authHandler.initialize();

    const userRow = await db.query<{ id: string }>(
      "SELECT id FROM auth.users WHERE email = $1",
      ["expired@example.com"],
    );
    const userId = userRow.rows[0]?.id;
    assertExists(userId);

    const rawToken = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const hashBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken),
    );
    const tokenHash = Array.from(new Uint8Array(hashBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await db.query(
      "INSERT INTO auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at, expires_at) VALUES (gen_random_uuid(), $1, 'magiclink', $2, $3, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '10 minutes')",
      [userId, tokenHash, "expired@example.com"],
    );

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        rawToken +
        "&type=magiclink",
    );
    assertNotEquals(verifyRes.status, 200);

    await db.close();
  });

  test("admin generate_link returns action_link and email_otp", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "genlink@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const res = await localFetch(
      "http://localhost:54321/auth/v1/admin/generate_link",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer local-service-role-key",
        },
        body: JSON.stringify({
          type: "magiclink",
          email: "genlink@example.com",
        }),
      },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      action_link?: string;
      email_otp?: string;
    };
    assertExists(body.action_link);
    assertExists(body.email_otp);

    await db.close();
  });

  test("admin generate_link token can be used to sign in", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "genlink2@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const res = await localFetch(
      "http://localhost:54321/auth/v1/admin/generate_link",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer local-service-role-key",
        },
        body: JSON.stringify({
          type: "magiclink",
          email: "genlink2@example.com",
        }),
      },
    );
    const { email_otp } = (await res.json()) as { email_otp: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        email_otp +
        "&type=magiclink",
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as { access_token?: string };
    assertExists(session.access_token);

    await db.close();
  });
});

// ============================================================================
// 3. Password Recovery
// ============================================================================

describe("Password Recovery", () => {
  test("POST /auth/v1/recover returns 200 and token", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "recover@example.com",
      password: "oldpass",
    });
    await supabase.auth.signOut();

    const res = await localFetch("http://localhost:54321/auth/v1/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "recover@example.com" }),
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token?: string };
    assertExists(body.token);

    await db.close();
  });

  test("recovery token can be verified for a session", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "recover2@example.com",
      password: "oldpass",
    });
    await supabase.auth.signOut();

    const recoverRes = await localFetch(
      "http://localhost:54321/auth/v1/recover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recover2@example.com" }),
      },
    );
    const { token } = (await recoverRes.json()) as { token: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type: "recovery" }),
      },
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as { access_token?: string };
    assertExists(session.access_token);

    await db.close();
  });

  test("after recovery verify, user can update password", async () => {
    const db = createPGlite();
    const { supabase, authHandler, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "recover3@example.com",
      password: "oldpass",
    });
    await supabase.auth.signOut();

    const recoverRes = await localFetch(
      "http://localhost:54321/auth/v1/recover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recover3@example.com" }),
      },
    );
    const { token } = (await recoverRes.json()) as { token: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type: "recovery" }),
      },
    );
    const { access_token } = (await verifyRes.json()) as {
      access_token: string;
    };

    const updateResult = await authHandler.updateUser(access_token, {
      password: "newpass123",
    });
    assertEquals(updateResult.error, null);

    const signInResult = await authHandler.signInWithPassword(
      "recover3@example.com",
      "newpass123",
    );
    assertEquals(signInResult.error, null);
    assertExists(signInResult.data.session);

    await db.close();
  });

  test("recovery token is single-use", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "recover4@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    const recoverRes = await localFetch(
      "http://localhost:54321/auth/v1/recover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recover4@example.com" }),
      },
    );
    const { token } = (await recoverRes.json()) as { token: string };

    await localFetch("http://localhost:54321/auth/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, type: "recovery" }),
    });

    const secondRes = await localFetch(
      "http://localhost:54321/auth/v1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type: "recovery" }),
      },
    );
    assertNotEquals(secondRes.status, 200);

    await db.close();
  });

  test("recovery for non-existent email returns 200 without leaking existence", async () => {
    const db = createPGlite();
    const { localFetch } = await createTestClient(db);

    const res = await localFetch("http://localhost:54321/auth/v1/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    assertEquals(res.status, 200);

    await db.close();
  });
});

// ============================================================================
// 4. Reauthentication
// ============================================================================

describe("Reauthentication", () => {
  test("GET /auth/v1/reauthenticate returns 200 for authenticated user", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "reauth@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    assertExists(token);

    const res = await localFetch(
      "http://localhost:54321/auth/v1/reauthenticate",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    assertEquals(res.status, 200);

    await db.close();
  });

  test("PUT /auth/v1/user with valid nonce succeeds", async () => {
    const db = createPGlite();
    const { supabase, authHandler, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "reauth2@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    assertExists(token);

    await localFetch("http://localhost:54321/auth/v1/reauthenticate", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const verified = await authHandler.verifyToken(token);
    const userId = verified.payload?.sub;
    const nonceRow = await db.query<{ reauthentication_token: string }>(
      "SELECT reauthentication_token FROM auth.users WHERE id = $1",
      [userId],
    );
    const nonce = nonceRow.rows[0]?.reauthentication_token;
    assertExists(nonce);

    const updateRes = await localFetch("http://localhost:54321/auth/v1/user", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: "newpass", nonce }),
    });
    assertEquals(updateRes.status, 200);

    await db.close();
  });

  test("PUT /auth/v1/user with invalid nonce returns error", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "reauth3@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;

    await localFetch("http://localhost:54321/auth/v1/reauthenticate", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const updateRes = await localFetch("http://localhost:54321/auth/v1/user", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: "newpass", nonce: "wrong-nonce" }),
    });
    assertNotEquals(updateRes.status, 200);

    await db.close();
  });

  test("nonce is cleared after use", async () => {
    const db = createPGlite();
    const { supabase, authHandler, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "reauth4@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    assertExists(token);

    await localFetch("http://localhost:54321/auth/v1/reauthenticate", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const verified = await authHandler.verifyToken(token);
    const userId = verified.payload?.sub;
    const nonceRow = await db.query<{ reauthentication_token: string }>(
      "SELECT reauthentication_token FROM auth.users WHERE id = $1",
      [userId],
    );
    const nonce = nonceRow.rows[0]?.reauthentication_token;

    await localFetch("http://localhost:54321/auth/v1/user", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: "newpass", nonce }),
    });

    const afterRow = await db.query<{ reauthentication_token: string | null }>(
      "SELECT reauthentication_token FROM auth.users WHERE id = $1",
      [userId],
    );
    assertEquals(afterRow.rows[0]?.reauthentication_token, null);

    await db.close();
  });
});

// ============================================================================
// 5. Resend
// ============================================================================

describe("Resend", () => {
  test("resend for unconfirmed user generates new token", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createTestClient(db);
    await authHandler.initialize();

    await db.query(
      "INSERT INTO auth.users (email, encrypted_password, aud, role, email_confirmed_at) VALUES ($1, auth.hash_password('pass'), 'authenticated', 'authenticated', NULL)",
      ["resend@example.com"],
    );

    const otpRes = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend@example.com" }),
    });
    const { token: firstToken } = (await otpRes.json()) as { token: string };
    assertExists(firstToken);

    const resendRes = await localFetch(
      "http://localhost:54321/auth/v1/resend",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "signup", email: "resend@example.com" }),
      },
    );
    assertEquals(resendRes.status, 200);
    const { token: newToken } = (await resendRes.json()) as { token: string };
    assertExists(newToken);
    assertNotEquals(newToken, firstToken);

    await db.close();
  });

  test("old token is invalidated after resend", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createTestClient(db);
    await authHandler.initialize();

    await db.query(
      "INSERT INTO auth.users (email, encrypted_password, aud, role, email_confirmed_at) VALUES ($1, auth.hash_password('pass'), 'authenticated', 'authenticated', NULL)",
      ["resend2@example.com"],
    );

    const otpRes = await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend2@example.com" }),
    });
    const { token: oldToken } = (await otpRes.json()) as { token: string };

    await localFetch("http://localhost:54321/auth/v1/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "signup", email: "resend2@example.com" }),
    });

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        oldToken +
        "&type=magiclink",
    );
    assertNotEquals(verifyRes.status, 200);

    await db.close();
  });

  test("new token from resend works for verification", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createTestClient(db);
    await authHandler.initialize();

    await db.query(
      "INSERT INTO auth.users (email, encrypted_password, aud, role, email_confirmed_at) VALUES ($1, auth.hash_password('pass'), 'authenticated', 'authenticated', NULL)",
      ["resend3@example.com"],
    );

    await localFetch("http://localhost:54321/auth/v1/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend3@example.com" }),
    });

    const resendRes = await localFetch(
      "http://localhost:54321/auth/v1/resend",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "signup", email: "resend3@example.com" }),
      },
    );
    const { token: newToken } = (await resendRes.json()) as { token: string };

    const verifyRes = await localFetch(
      "http://localhost:54321/auth/v1/verify?token=" +
        newToken +
        "&type=magiclink",
    );
    assertEquals(verifyRes.status, 200);

    await db.close();
  });
});

// ============================================================================
// 6. Invite
// ============================================================================

describe("Invite", () => {
  test("invite creates user record and returns token", async () => {
    const db = createPGlite();
    const { localFetch } = await createTestClient(db);

    const res = await localFetch("http://localhost:54321/auth/v1/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer local-service-role-key",
      },
      body: JSON.stringify({ email: "invite@example.com" }),
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token?: string };
    assertExists(body.token);

    await db.close();
  });

  test("verify with invite token returns session", async () => {
    const db = createPGlite();
    const { localFetch } = await createTestClient(db);

    const inviteRes = await localFetch(
      "http://localhost:54321/auth/v1/invite",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer local-service-role-key",
        },
        body: JSON.stringify({ email: "invite2@example.com" }),
      },
    );
    const { token } = (await inviteRes.json()) as { token: string };

    const verifyRes = await localFetch(
      `http://localhost:54321/auth/v1/verify?token=${token}&type=invite`,
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as { access_token?: string };
    assertExists(session.access_token);

    await db.close();
  });

  test("invite to existing user does not create duplicate", async () => {
    const db = createPGlite();
    const { supabase, localFetch, authHandler } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "existing@example.com",
      password: "pass",
    });

    await localFetch("http://localhost:54321/auth/v1/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer local-service-role-key",
      },
      body: JSON.stringify({ email: "existing@example.com" }),
    });

    const { total } = await authHandler.adminListUsers();
    assertEquals(total, 1);

    await db.close();
  });
});

// ============================================================================
// 7. MFA TOTP
// ============================================================================

describe("MFA TOTP", () => {
  test("enroll TOTP factor returns QR code and secret", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    assertExists(token);

    const res = await localFetch("http://localhost:54321/auth/v1/factors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        factor_type: "totp",
        friendly_name: "my authenticator",
      }),
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      id?: string;
      totp?: { qr_code: string; secret: string; uri: string };
    };
    assertExists(body.id);
    assertExists(body.totp?.qr_code);
    assertExists(body.totp?.secret);
    assertExists(body.totp?.uri);

    await db.close();
  });

  test("challenge factor returns challenge id", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa2@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;

    const enrollRes = await localFetch(
      "http://localhost:54321/auth/v1/factors",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ factor_type: "totp" }),
      },
    );
    const { id: factorId } = (await enrollRes.json()) as { id: string };

    const challengeRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}/challenge`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    assertEquals(challengeRes.status, 200);
    const challenge = (await challengeRes.json()) as {
      id?: string;
      expires_at?: number;
    };
    assertExists(challenge.id);
    assertExists(challenge.expires_at);

    await db.close();
  });

  test("verify with correct TOTP code returns session", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa3@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;

    const enrollRes = await localFetch(
      "http://localhost:54321/auth/v1/factors",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ factor_type: "totp" }),
      },
    );
    const { id: factorId, totp } = (await enrollRes.json()) as {
      id: string;
      totp: { secret: string };
    };

    const challengeRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}/challenge`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const { id: challengeId } = (await challengeRes.json()) as { id: string };

    const { base32 } = await import("@scure/base");
    const { generateTOTP } = await import("@oslojs/otp");
    const secretBytes = base32.decode(totp.secret);
    const code = generateTOTP(secretBytes, 30, 6);

    const verifyRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ challenge_id: challengeId, code }),
      },
    );
    assertEquals(verifyRes.status, 200);
    const session = (await verifyRes.json()) as { access_token?: string };
    assertExists(session.access_token);

    await db.close();
  });

  test("verify with wrong TOTP code returns error", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa4@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;

    const enrollRes = await localFetch(
      "http://localhost:54321/auth/v1/factors",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ factor_type: "totp" }),
      },
    );
    const { id: factorId } = (await enrollRes.json()) as { id: string };

    const challengeRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}/challenge`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const { id: challengeId } = (await challengeRes.json()) as { id: string };

    const verifyRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ challenge_id: challengeId, code: "000000" }),
      },
    );
    assertNotEquals(verifyRes.status, 200);

    await db.close();
  });

  test("delete factor removes it", async () => {
    const db = createPGlite();
    const { supabase, authHandler, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa5@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    assertExists(token);

    const enrollRes = await localFetch(
      "http://localhost:54321/auth/v1/factors",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ factor_type: "totp" }),
      },
    );
    const { id: factorId } = (await enrollRes.json()) as { id: string };

    const deleteRes = await localFetch(
      `http://localhost:54321/auth/v1/factors/${factorId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    assertEquals(deleteRes.status, 200);

    const verified = await authHandler.verifyToken(token);
    const userId = verified.payload?.sub;
    const row = await db.query<{ count: number }>(
      "SELECT count(*)::int as count FROM auth.mfa_factors WHERE user_id = $1",
      [userId],
    );
    assertEquals(row.rows[0]?.count, 0);

    await db.close();
  });

  test("admin list factors returns enrolled factors", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    const signUp = await supabase.auth.signUp({
      email: "mfa6@example.com",
      password: "pass",
    });
    const token = signUp.data.session?.access_token;
    const userId = signUp.data.user?.id;

    await localFetch("http://localhost:54321/auth/v1/factors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ factor_type: "totp" }),
    });

    const res = await localFetch(
      `http://localhost:54321/auth/v1/admin/users/${userId}/factors`,
      {
        headers: { Authorization: "Bearer local-service-role-key" },
      },
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { factors: { id: string }[] };
    assertEquals(body.factors.length, 1);

    await db.close();
  });
});

// ============================================================================
// 8. Audit Logs
// ============================================================================

describe("Audit Logs", () => {
  test("signup creates audit log entry", async () => {
    const db = createPGlite();
    const { supabase, authHandler } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "audit@example.com",
      password: "pass",
    });
    await authHandler.initialize();

    const rows = await db.query<{ payload: { action: string } }>(
      "SELECT payload FROM auth.audit_log_entries ORDER BY created_at DESC LIMIT 1",
    );
    const action = rows.rows[0]?.payload?.action;
    assertEquals(action, "signup");

    await db.close();
  });

  test("signin creates audit log entry", async () => {
    const db = createPGlite();
    const { supabase, authHandler } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "audit2@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: "audit2@example.com",
      password: "pass",
    });

    await authHandler.initialize();
    const rows = await db.query<{ payload: { action: string } }>(
      "SELECT payload FROM auth.audit_log_entries WHERE payload->>'action' = 'login' LIMIT 1",
    );
    assertExists(rows.rows[0]);

    await db.close();
  });

  test("signout creates audit log entry", async () => {
    const db = createPGlite();
    const { supabase, authHandler } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "audit3@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();

    await authHandler.initialize();
    const rows = await db.query<{ payload: { action: string } }>(
      "SELECT payload FROM auth.audit_log_entries WHERE payload->>'action' = 'logout' LIMIT 1",
    );
    assertExists(rows.rows[0]);

    await db.close();
  });

  test("failed signin creates audit log entry", async () => {
    const db = createPGlite();
    const { supabase, authHandler } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "audit4@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: "audit4@example.com",
      password: "wrong",
    });

    await authHandler.initialize();
    const rows = await db.query<{ payload: { action: string } }>(
      "SELECT payload FROM auth.audit_log_entries WHERE payload->>'action' = 'login_failed' LIMIT 1",
    );
    assertExists(rows.rows[0]);

    await db.close();
  });

  test("GET /admin/audit returns entries in reverse chronological order", async () => {
    const db = createPGlite();
    const { supabase, localFetch } = await createTestClient(db);

    await supabase.auth.signUp({
      email: "audit5@example.com",
      password: "pass",
    });
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: "audit5@example.com",
      password: "pass",
    });

    const res = await localFetch("http://localhost:54321/auth/v1/admin/audit", {
      headers: { Authorization: "Bearer local-service-role-key" },
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as { entries: { created_at: string }[] };
    assertExists(body.entries);
    assertEquals(body.entries.length > 0, true);

    if (body.entries.length > 1) {
      const times = body.entries.map((e) => new Date(e.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        assertEquals((times[i - 1] ?? 0) >= (times[i] ?? 0), true);
      }
    }

    await db.close();
  });
});
