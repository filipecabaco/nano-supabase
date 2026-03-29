import { createFetchAdapter } from "../src/client.ts";
import { createPGlite } from "../src/pglite-factory.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  describe,
  test,
} from "./compat.ts";

const SUPABASE_URL = "http://localhost:54321";

// ============================================================================
// Auth Routes - Sign Up
// ============================================================================

describe("Fetch Auth - Sign Up", () => {
  test("POST /auth/v1/signup succeeds", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
      }),
    });

    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.user);
    assertExists(data.access_token);
    assertExists(data.refresh_token);
    assertEquals(data.user.email, "test@example.com");
    assertEquals(data.user.role, "authenticated");
    assertEquals(data.token_type, "bearer");
    assertExists(data.expires_in);
    assertExists(data.expires_at);

    await db.close();
  });

  test("POST /auth/v1/signup with metadata", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
        options: {
          data: { display_name: "Test User" },
        },
      }),
    });

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.user.user_metadata.display_name, "Test User");

    await db.close();
  });

  test("POST /auth/v1/signup rejects missing email", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "password123",
      }),
    });

    assertEquals(response.status, 400);

    const data = await response.json();
    assertExists(data.error);

    await db.close();
  });

  test("POST /auth/v1/signup rejects missing password", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
      }),
    });

    assertEquals(response.status, 400);

    await db.close();
  });

  test("POST /auth/v1/signup rejects duplicate email", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // First signup
    await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
      }),
    });

    // Second signup with same email
    const response = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "different_password",
      }),
    });

    assertEquals(response.status, 400);

    const data = await response.json();
    assertEquals(data.error, "user_already_exists");

    await db.close();
  });
});

// ============================================================================
// Auth Routes - Sign In (Token)
// ============================================================================

describe("Fetch Auth - Sign In", () => {
  test("POST /auth/v1/token?grant_type=password succeeds", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    await authHandler.signUp("test@example.com", "password123");

    const response = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
        }),
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.access_token);
    assertExists(data.refresh_token);
    assertExists(data.user);
    assertEquals(data.token_type, "bearer");
    assertExists(data.expires_in);
    assertExists(data.expires_at);

    await db.close();
  });

  test("POST /auth/v1/token rejects wrong password", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    await authHandler.signUp("test@example.com", "password123");

    const response = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "wrongpassword",
        }),
      },
    );

    assertEquals(response.status, 400);

    const data = await response.json();
    assertEquals(data.error, "invalid_grant");

    await db.close();
  });

  test("POST /auth/v1/token?grant_type=refresh_token succeeds", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const refreshToken = signUpResult.data.session?.refresh_token;

    const response = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertExists(data.access_token);
    assertExists(data.refresh_token);
    assertNotEquals(data.refresh_token, refreshToken); // New token

    await db.close();
  });

  test("POST /auth/v1/token rejects invalid refresh token", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: "invalid-token",
        }),
      },
    );

    assertEquals(response.status, 401);

    await db.close();
  });

  test("POST /auth/v1/token rejects unsupported grant type", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=unsupported`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    assertEquals(response.status, 400);

    const data = await response.json();
    assertEquals(data.error, "unsupported_grant_type");

    await db.close();
  });
});

// ============================================================================
// Auth Routes - User
// ============================================================================

describe("Fetch Auth - User", () => {
  test("GET /auth/v1/user returns user", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.email, "test@example.com");
    assertExists(data.id);

    await db.close();
  });

  test("GET /auth/v1/user rejects missing auth", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
    });

    assertEquals(response.status, 401);

    await db.close();
  });

  test("GET /auth/v1/user rejects invalid token", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: "Bearer invalid-token",
      },
    });

    assertEquals(response.status, 401);

    await db.close();
  });

  test("PUT /auth/v1/user updates user", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        data: { display_name: "Updated Name" },
      }),
    });

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.user_metadata.display_name, "Updated Name");

    await db.close();
  });

  test("PUT /auth/v1/user rejects missing auth", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { test: true },
      }),
    });

    assertEquals(response.status, 401);

    await db.close();
  });
});

// ============================================================================
// Auth Routes - Logout
// ============================================================================

describe("Fetch Auth - Logout", () => {
  test("POST /auth/v1/logout succeeds", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    assertEquals(response.status, 200);

    await db.close();
  });

  test("POST /auth/v1/logout works without token", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
    });

    assertEquals(response.status, 200);

    await db.close();
  });
});

// ============================================================================
// Auth Routes - Session
// ============================================================================

describe("Fetch Auth - Session", () => {
  test("GET /auth/v1/session returns session", async () => {
    const db = createPGlite();
    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/session`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    assertEquals(response.status, 200);

    await db.close();
  });

  test("GET /auth/v1/session returns null without auth", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/session`, {
      method: "GET",
    });

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.session, null);

    await db.close();
  });
});

// ============================================================================
// Auth Routes - Not Found
// ============================================================================

describe("Fetch Auth - Not Found", () => {
  test("Unknown auth endpoint returns 404", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/auth/v1/unknown`, {
      method: "GET",
    });

    assertEquals(response.status, 404);

    await db.close();
  });
});
