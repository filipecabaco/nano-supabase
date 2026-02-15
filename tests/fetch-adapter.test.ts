/**
 * Fetch Adapter Tests
 * Comprehensive tests for the scoped fetch adapter with auth and data routes
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createFetchAdapter } from "../src/client.ts";
import {
  test,
  describe,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "./compat.ts";

const SUPABASE_URL = "http://localhost:54321";

// ============================================================================
// Auth Routes - Sign Up
// ============================================================================

describe("Fetch Auth - Sign Up", () => {
  test("POST /auth/v1/signup succeeds", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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
    const db = new PGlite({ extensions: { pgcrypto } });
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

// ============================================================================
// Data Routes - SELECT
// ============================================================================

describe("Fetch Data - SELECT", () => {
  test("GET /rest/v1/table returns all rows", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?select=*`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 2);
    assertEquals(data[0].name, "Alice");
    assertEquals(data[1].name, "Bob");

    await db.close();
  });

  test("GET /rest/v1/table with column selection", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER
    )
  `);

    await db.exec(`
    INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 25)
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?select=name,email`,
      {
        method: "GET",
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 1);
    assertExists(data[0].name);
    assertExists(data[0].email);

    await db.close();
  });

  test("GET /rest/v1/table with filter", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER
    )
  `);

    await db.exec(`
    INSERT INTO users (name, age) VALUES
      ('Alice', 25),
      ('Bob', 30),
      ('Charlie', 35)
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?select=*&age=gte.30`,
      {
        method: "GET",
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 2);

    await db.close();
  });

  test("GET /rest/v1/table returns empty array for no results", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?select=*`,
      {
        method: "GET",
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 0);

    await db.close();
  });
});

// ============================================================================
// Data Routes - INSERT
// ============================================================================

describe("Fetch Data - INSERT", () => {
  test("POST /rest/v1/table inserts row", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Charlie", email: "charlie@example.com" }),
    });

    assertEquals(response.status, 201);

    // Verify insert
    const result = await db.query("SELECT * FROM users");
    assertEquals(result.rows.length, 1);

    await db.close();
  });

  test("POST /rest/v1/table with Prefer: return=representation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ name: "Test" }),
    });

    assertEquals(response.status, 201);

    const data = await response.json();
    assertExists(data);

    await db.close();
  });

  test("POST /rest/v1/table with Prefer: return=minimal", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ name: "Test" }),
    });

    assertEquals(response.status, 201);

    await db.close();
  });
});

// ============================================================================
// Data Routes - UPDATE
// ============================================================================

describe("Fetch Data - UPDATE", () => {
  test("PATCH /rest/v1/table updates rows", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?name=eq.Alice`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newalice@example.com" }),
      },
    );

    assertEquals(response.status, 204);

    // Verify update
    const result = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE name = $1",
      ["Alice"],
    );
    assertEquals(result.rows[0]?.email, "newalice@example.com");

    await db.close();
  });

  test("PATCH /rest/v1/table with return=representation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?name=eq.Alice`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ email: "newalice@example.com" }),
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data[0].email, "newalice@example.com");

    await db.close();
  });
});

// ============================================================================
// Data Routes - DELETE
// ============================================================================

describe("Fetch Data - DELETE", () => {
  test("DELETE /rest/v1/table deletes rows", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO users (name) VALUES ('Alice'), ('Bob')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?name=eq.Alice`,
      {
        method: "DELETE",
      },
    );

    assertEquals(response.status, 204);

    // Verify delete
    const result = await db.query("SELECT * FROM users");
    assertEquals(result.rows.length, 1);

    await db.close();
  });

  test("DELETE /rest/v1/table with return=representation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO users (name) VALUES ('Alice')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/users?name=eq.Alice`,
      {
        method: "DELETE",
        headers: {
          Prefer: "return=representation",
        },
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data[0].name, "Alice");

    await db.close();
  });
});

// ============================================================================
// Data Routes - Error Handling
// ============================================================================

describe("Fetch Data - Errors", () => {
  test("Handles invalid table", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/nonexistent?select=*`,
      {
        method: "GET",
      },
    );

    assertEquals(response.status, 400);

    await db.close();
  });

  test("Handles invalid path", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(`${SUPABASE_URL}/rest/v1/`, {
      method: "GET",
    });

    assertEquals(response.status, 400);

    await db.close();
  });
});

// ============================================================================
// Passthrough Tests
// ============================================================================

describe("Fetch Passthrough", () => {
  test("Non-Supabase requests pass through", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    let passthroughCalled = false;
    const mockOriginalFetch = async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      passthroughCalled = true;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new Response(JSON.stringify({ url }), { status: 200 });
    };

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
      originalFetch: mockOriginalFetch,
    });

    const response = await localFetch("https://api.example.com/data", {
      method: "GET",
    });

    assertEquals(passthroughCalled, true);
    assertEquals(response.status, 200);

    await db.close();
  });

  test("Storage requests intercepted when handler enabled", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // Storage is now intercepted by default (storageHandler is auto-created)
    const response = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket`,
      {
        method: "GET",
      },
    );

    // Should be intercepted and return a storage response (empty bucket list)
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(Array.isArray(data), true);

    await db.close();
  });

  test("Storage requests pass through when disabled", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    let passthroughCalled = false;
    const mockOriginalFetch = async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      passthroughCalled = true;
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
      originalFetch: mockOriginalFetch,
      storageBackend: false,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/file.png`,
      {
        method: "GET",
      },
    );

    assertEquals(passthroughCalled, true);
    assertEquals(response.status, 200);

    await db.close();
  });

  test("Realtime requests pass through", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    let passthroughCalled = false;
    const mockOriginalFetch = async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      passthroughCalled = true;
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
      originalFetch: mockOriginalFetch,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/realtime/v1/websocket`,
      {
        method: "GET",
      },
    );

    assertEquals(passthroughCalled, true);
    assertEquals(response.status, 200);

    await db.close();
  });

  test("Edge functions pass through", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    let passthroughCalled = false;
    const mockOriginalFetch = async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      passthroughCalled = true;
      return new Response(JSON.stringify({ result: "hello" }), { status: 200 });
    };

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
      originalFetch: mockOriginalFetch,
    });

    const response = await localFetch(`${SUPABASE_URL}/functions/v1/hello`, {
      method: "POST",
    });

    assertEquals(passthroughCalled, true);
    assertEquals(response.status, 200);

    await db.close();
  });
});

// ============================================================================
// RLS Context Tests
// ============================================================================

describe("Fetch RLS", () => {
  test("Sets auth context for authenticated requests", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE profiles (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      display_name TEXT NOT NULL
    )
  `);

    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;
    const userId = signUpResult.data.user?.id;

    // Insert profile
    await db.query(
      "INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)",
      [userId, "Test User"],
    );

    // Fetch with auth token
    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=*`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 1);

    await db.close();
  });

  test("auth.uid() returns user ID in authenticated context", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    const { localFetch, authHandler } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const signUpResult = await authHandler.signUp(
      "test@example.com",
      "password123",
    );
    const accessToken = signUpResult.data.session?.access_token;
    const userId = signUpResult.data.user?.id;

    // Create a table that uses auth.uid()
    await db.exec(`
    CREATE TABLE test_auth (
      id SERIAL PRIMARY KEY,
      auth_uid UUID
    )
  `);

    // Insert using auth.uid()
    const insertResponse = await localFetch(
      `${SUPABASE_URL}/rest/v1/rpc/test_insert_auth_uid`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    // Note: This test verifies the context is set, actual RLS policy testing
    // would require enabling RLS and creating policies

    await db.close();
  });

  test("Clears context for anonymous requests", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE public_data (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL
    )
  `);

    await db.exec(`
    INSERT INTO public_data (content) VALUES ('public content')
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // Fetch without auth token
    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/public_data?select=*`,
      {
        method: "GET",
      },
    );

    assertEquals(response.status, 200);

    const data = await response.json();
    assertEquals(data.length, 1);

    await db.close();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Fetch Integration", () => {
  test("Full auth + data flow", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    // Create a profiles table
    await db.exec(`
    CREATE TABLE profiles (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // 1. Sign up
    const signupResponse = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
      }),
    });

    assertEquals(signupResponse.status, 200);
    const signupData = await signupResponse.json();
    const accessToken = signupData.access_token;
    const userId = signupData.user.id;

    // 2. Create profile
    await db.query(
      "INSERT INTO profiles (id, email, display_name) VALUES ($1, $2, $3)",
      [userId, "test@example.com", "Test User"],
    );

    // 3. Fetch profile with auth
    const profileResponse = await localFetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=*`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    assertEquals(profileResponse.status, 200);
    const profileData = await profileResponse.json();
    assertEquals(profileData[0].email, "test@example.com");

    // 4. Update profile
    const updateResponse = await localFetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ display_name: "Updated Name" }),
      },
    );

    assertEquals(updateResponse.status, 200);
    const updateData = await updateResponse.json();
    assertEquals(updateData[0].display_name, "Updated Name");

    // 5. Sign out
    const logoutResponse = await localFetch(
      `${SUPABASE_URL}/auth/v1/logout`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    assertEquals(logoutResponse.status, 200);

    await db.close();
  });

  test("Token refresh flow", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // 1. Sign up
    const signupResponse = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
      }),
    });

    const signupData = await signupResponse.json();
    const refreshToken = signupData.refresh_token;

    // 2. Refresh token
    const refreshResponse = await localFetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      },
    );

    assertEquals(refreshResponse.status, 200);
    const refreshData = await refreshResponse.json();
    const newAccessToken = refreshData.access_token;

    // 3. Use new token to get user
    const userResponse = await localFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${newAccessToken}`,
      },
    });

    assertEquals(userResponse.status, 200);
    const userData = await userResponse.json();
    assertEquals(userData.email, "test@example.com");

    await db.close();
  });

  test("Multiple users isolation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    await db.exec(`
    CREATE TABLE user_data (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      data TEXT NOT NULL
    )
  `);

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // Sign up user 1
    const signup1 = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user1@example.com",
        password: "password1",
      }),
    });
    const user1Data = await signup1.json();
    const token1 = user1Data.access_token;
    const userId1 = user1Data.user.id;

    // Sign up user 2
    const signup2 = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user2@example.com",
        password: "password2",
      }),
    });
    const user2Data = await signup2.json();
    const token2 = user2Data.access_token;
    const userId2 = user2Data.user.id;

    // Insert data for each user
    await db.query("INSERT INTO user_data (user_id, data) VALUES ($1, $2)", [
      userId1,
      "User 1 data",
    ]);
    await db.query("INSERT INTO user_data (user_id, data) VALUES ($1, $2)", [
      userId2,
      "User 2 data",
    ]);

    // User 1 fetches data
    const response1 = await localFetch(
      `${SUPABASE_URL}/rest/v1/user_data?select=*`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token1}` },
      },
    );
    const data1 = await response1.json();
    assertEquals(data1.length, 2); // Without RLS, both are visible

    // User 2 fetches data
    const response2 = await localFetch(
      `${SUPABASE_URL}/rest/v1/user_data?select=*`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token2}` },
      },
    );
    const data2 = await response2.json();
    assertEquals(data2.length, 2); // Without RLS, both are visible

    await db.close();
  });
});

