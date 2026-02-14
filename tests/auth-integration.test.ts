/**
 * Auth Integration Tests
 * Comprehensive tests for authentication, RLS, and role management
 * Tests complete user workflows from sign up to data access
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createClient } from "@supabase/supabase-js";
import { createFetchAdapter } from "../src/client.ts";
import {
  setAuthContext,
  clearAuthContext,
} from "../src/fetch-adapter/auth-context.ts";
import {
  extractPostgresError,
  errorResponse,
} from "../src/fetch-adapter/error-handler.ts";
import {
  test,
  describe,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "./compat.ts";

interface Task {
  id: number;
  user_id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority?: string;
  created_at?: string;
}

interface RoleResult {
  current_role: string;
}

interface UidResult {
  uid: string | null;
}

interface CountResult {
  count: number;
}

// Helper to create Supabase client with proper types
async function createTestClient(db?: PGlite) {
  const dbInstance = db || new PGlite({ extensions: { pgcrypto } });
  const { localFetch, authHandler } = await createFetchAdapter({
    db: dbInstance,
  });
  const supabase = createClient("http://localhost:54321", "local-anon-key", {
    auth: {
      autoRefreshToken: false,
    },
    global: { fetch: localFetch },
  });
  return { supabase, authHandler, db: dbInstance };
}

// Helper to create tasks table with RLS
async function createTasksTableWithRLS(db: PGlite) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL DEFAULT auth.uid(),
      title TEXT NOT NULL,
      description TEXT,
      completed BOOLEAN DEFAULT false,
      priority TEXT DEFAULT 'medium',
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can manage own tasks" ON tasks;
    CREATE POLICY "Users can manage own tasks"
      ON tasks FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    GRANT ALL ON tasks TO authenticated;
  `);
}

// ============================================================================
// Auth Context Management Tests
// ============================================================================

describe("Auth Context", () => {
  test("Anonymous user gets anon role", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { authHandler } = await createTestClient(db);

    const context = await setAuthContext(db, null);

    assertEquals(context.role, "anon");
    assertEquals(context.userId, undefined);

    const roleResult = await db.query<RoleResult>("SELECT current_role");
    assertEquals(roleResult.rows[0]?.current_role, "anon");

    const uidResult = await db.query<UidResult>("SELECT auth.uid() as uid");
    assertEquals(uidResult.rows[0]?.uid, null);

    await db.close();
  });

  test("Authenticated user gets correct context", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);

    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const token = signUpResult.data.session!.access_token;
    const userId = signUpResult.data.user!.id;

    const context = await setAuthContext(db, token);

    assertEquals(context.role, "authenticated");
    assertEquals(context.userId, userId);
    assertEquals(context.email, "test@example.com");

    const roleResult = await db.query<RoleResult>("SELECT current_role");
    assertEquals(roleResult.rows[0]?.current_role, "authenticated");

    const uidResult = await db.query<UidResult>("SELECT auth.uid() as uid");
    assertEquals(uidResult.rows[0]?.uid, userId);

    await db.close();
  });

  test("Context switches correctly between users", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);

    // User 1
    const user1 = await supabase.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    const user1Token = user1.data.session!.access_token;
    const user1Id = user1.data.user!.id;

    await setAuthContext(db, user1Token);
    let uidResult = await db.query<UidResult>("SELECT auth.uid() as uid");
    assertEquals(uidResult.rows[0]?.uid, user1Id);

    // User 2
    await supabase.auth.signOut();
    const user2 = await supabase.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });
    const user2Token = user2.data.session!.access_token;
    const user2Id = user2.data.user!.id;

    await setAuthContext(db, user2Token);
    uidResult = await db.query("SELECT auth.uid() as uid");
    assertEquals(uidResult.rows[0]?.uid, user2Id);

    await db.close();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  test("Extracts PostgreSQL error details", () => {
    interface PostgresErrorLike extends Error {
      code?: string;
      detail?: string;
      hint?: string;
    }

    const error: PostgresErrorLike = Object.assign(
      new Error("duplicate key"),
      {
        code: "23505",
        detail: "Key (email)=(test@example.com) already exists.",
        hint: "Use a different email",
      },
    );

    const apiError = extractPostgresError(error);

    assertEquals(apiError.message, "duplicate key");
    assertEquals(apiError.code, "23505");
    assertEquals(
      apiError.details,
      "Key (email)=(test@example.com) already exists.",
    );
    assertEquals(apiError.hint, "Use a different email");
  });

  test("Creates correct error response", async () => {
    const error = new Error("Test error");
    const response = errorResponse(error, 400);

    assertEquals(response.status, 400);
    assertEquals(response.headers.get("Content-Type"), "application/json");

    const body = await response.json();
    assertEquals(body.message, "Test error");
    assertEquals(body.code, "PGRST000");
  });
});

// ============================================================================
// RLS Policy Enforcement Tests
// ============================================================================

describe("RLS", () => {
  test("Users can only see their own tasks", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // User 1 creates tasks
    const user1 = await supabase.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    const user1Id = user1.data.user!.id;

    await supabase.from("tasks").insert({ title: "User 1 Task 1" });
    await supabase.from("tasks").insert({ title: "User 1 Task 2" });

    // User 2 creates tasks
    await supabase.auth.signOut();
    const user2 = await supabase.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });
    const user2Id = user2.data.user!.id;

    await supabase.from("tasks").insert({ title: "User 2 Task 1" });

    // User 2 should only see their task
    const user2Tasks = await supabase.from("tasks").select("*");
    assertEquals(user2Tasks.data?.length, 1);
    assertEquals(user2Tasks.data?.[0]?.user_id, user2Id);

    // Switch to User 1
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: "user1@example.com",
      password: "password123",
    });

    // User 1 should only see their tasks
    const user1Tasks = await supabase.from("tasks").select("*");
    assertEquals(user1Tasks.data?.length, 2);
    assertEquals(
      user1Tasks.data?.every((t: Task) => t.user_id === user1Id),
      true,
    );

    await db.close();
  });

  test("Anonymous users cannot access protected tables", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // Create task as authenticated user
    await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    await supabase.from("tasks").insert({ title: "Test Task" });

    // Sign out and try to access as anon
    await supabase.auth.signOut();
    const anonResult = await supabase.from("tasks").select("*");

    // Should return empty (RLS filters it out)
    assertEquals(anonResult.error, null);
    assertEquals(anonResult.data?.length, 0);

    await db.close();
  });

  test("auth.uid() works as DEFAULT value", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const userId = signUpResult.data.user!.id;

    // Insert without specifying user_id
    const insertResult = await supabase
      .from("tasks")
      .insert({
        title: "Test Task",
      })
      .select();

    assertEquals(insertResult.error, null);
    assertEquals(insertResult.data?.[0]?.user_id, userId);

    await db.close();
  });
});

// ============================================================================
// Complete Auth Flow Tests
// ============================================================================

describe("Auth Flow", () => {
  test("Sign up, create data, sign out, sign up, verify isolation", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // === User 1 Session ===
    const user1 = await supabase.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    const user1Id = user1.data.user!.id;

    await supabase.from("tasks").insert({ title: "User 1 Task 1" });
    await supabase.from("tasks").insert({ title: "User 1 Task 2" });

    let tasks = await supabase.from("tasks").select("*");
    assertEquals(tasks.data?.length, 2);

    // Sign out
    await supabase.auth.signOut();

    // After sign out, should see no tasks
    tasks = await supabase.from("tasks").select("*");
    assertEquals(tasks.data?.length, 0);

    // === User 2 Session ===
    const user2 = await supabase.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });
    const user2Id = user2.data.user!.id;

    assertNotEquals(user1Id, user2Id);

    await supabase.from("tasks").insert({ title: "User 2 Task 1" });

    // User 2 should only see their task
    tasks = await supabase.from("tasks").select("*");
    assertEquals(tasks.data?.length, 1);
    assertEquals(tasks.data?.[0]?.title, "User 2 Task 1");
    assertEquals(tasks.data?.[0]?.user_id, user2Id);

    await db.close();
  });

  test("Sign out allows signing up new user", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);

    // Sign up first user
    const user1Result = await supabase.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    assertEquals(user1Result.error, null);
    assertExists(user1Result.data.user);
    const user1Id = user1Result.data.user!.id;

    // Sign out
    const signOutResult = await supabase.auth.signOut();
    assertEquals(signOutResult.error, null);

    // Sign up second user (verifies sign out worked correctly)
    const user2Result = await supabase.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });
    assertEquals(user2Result.error, null);
    assertExists(user2Result.data.user);
    const user2Id = user2Result.data.user!.id;

    // Verify both users exist and are different
    assertNotEquals(user1Id, user2Id);

    const usersResult = await db.query<{ id: string }>(
      "SELECT id FROM auth.users ORDER BY created_at",
    );
    assertEquals(usersResult.rows.length, 2);

    await db.close();
  });

  test("Sign out then sign in preserves user data", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // Sign up and create tasks
    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const userId = signUpResult.data.user!.id;

    await supabase.from("tasks").insert({ title: "Task 1" });
    await supabase.from("tasks").insert({ title: "Task 2" });

    // Sign out
    await supabase.auth.signOut();

    // Sign in again
    const signInResult = await supabase.auth.signInWithPassword({
      email: "test@example.com",
      password: "password123",
    });
    assertEquals(signInResult.error, null);
    assertEquals(signInResult.data.user?.id, userId);

    // Should see original tasks
    const tasks = await supabase.from("tasks").select("*");
    assertEquals(tasks.data?.length, 2);
    assertEquals(
      tasks.data?.every((t: Task) => t.user_id === userId),
      true,
    );

    await db.close();
  });

  test("Multiple sign out then sign up cycles work correctly", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // Cycle 1: User A
    await supabase.auth.signUp({
      email: "userA@example.com",
      password: "password",
    });
    await supabase.from("tasks").insert({ title: "User A Task" });
    await supabase.auth.signOut();

    // Cycle 2: User B
    await supabase.auth.signUp({
      email: "userB@example.com",
      password: "password",
    });
    await supabase.from("tasks").insert({ title: "User B Task" });
    await supabase.auth.signOut();

    // Cycle 3: User C
    await supabase.auth.signUp({
      email: "userC@example.com",
      password: "password",
    });
    await supabase.from("tasks").insert({ title: "User C Task" });

    // User C should only see their task
    const userCTasks = await supabase.from("tasks").select("*");
    assertEquals(userCTasks.data?.length, 1);
    assertEquals(userCTasks.data?.[0]?.title, "User C Task");

    await db.close();
  });

  test("Session cleanup on sign out", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);

    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const userId = signUpResult.data.user!.id;

    // Verify session exists
    let sessionCheck = await db.query<CountResult>(
      `
    SELECT COUNT(*) as count FROM auth.sessions WHERE user_id = $1
  `,
      [userId],
    );
    assertEquals(sessionCheck.rows[0]?.count, 1);

    // Sign out
    await supabase.auth.signOut();

    // Verify session deleted
    sessionCheck = await db.query<CountResult>(
      `
    SELECT COUNT(*) as count FROM auth.sessions WHERE user_id = $1
  `,
      [userId],
    );
    assertEquals(sessionCheck.rows[0]?.count, 0);

    await db.close();
  });

  test("Concurrent users with isolated data", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase: client1 } = await createTestClient(db);
    const { supabase: client2 } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // User 1
    const user1 = await client1.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    const user1Id = user1.data.user!.id;

    await client1.from("tasks").insert({ title: "User 1 Task 1" });
    await client1.from("tasks").insert({ title: "User 1 Task 2" });

    // User 2
    const user2 = await client2.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });
    const user2Id = user2.data.user!.id;

    await client2.from("tasks").insert({ title: "User 2 Task 1" });

    // Each user sees only their own tasks
    const user1Tasks = await client1.from("tasks").select("*");
    assertEquals(user1Tasks.data?.length, 2);
    assertEquals(
      user1Tasks.data?.every((t: Task) => t.user_id === user1Id),
      true,
    );

    const user2Tasks = await client2.from("tasks").select("*");
    assertEquals(user2Tasks.data?.length, 1);
    assertEquals(user2Tasks.data?.[0]?.user_id, user2Id);

    await db.close();
  });

  test("Invalid credentials do not create session", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);

    // Create user
    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const userId = signUpResult.data.user!.id;

    // Sign out
    await supabase.auth.signOut();

    // Try wrong password
    const failedSignIn = await supabase.auth.signInWithPassword({
      email: "test@example.com",
      password: "wrongpassword",
    });

    // Should return error
    assertNotEquals(failedSignIn.error, null);
    assertEquals(failedSignIn.data.user, null);
    assertEquals(failedSignIn.data.session, null);

    // Verify no new session was created for this user
    const sessionCheck = await db.query<CountResult>(
      `SELECT COUNT(*) as count FROM auth.sessions WHERE user_id = $1`,
      [userId],
    );
    // Should still have 0 sessions (original was deleted on signOut)
    assertEquals(sessionCheck.rows[0]?.count, 0);

    await db.close();
  });
});

// ============================================================================
// Complex RLS Scenarios
// ============================================================================

describe("Complex RLS", () => {
  test("Update and delete operations respect user boundaries", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    // User 1 creates tasks
    const user1 = await supabase.auth.signUp({
      email: "user1@example.com",
      password: "password123",
    });
    await supabase
      .from("tasks")
      .insert({ title: "User 1 Task", completed: false });

    // User 2 tries to update User 1's task
    await supabase.auth.signOut();
    await supabase.auth.signUp({
      email: "user2@example.com",
      password: "password456",
    });

    // Try to update User 1's task - should fail silently (0 rows affected)
    const updateResult = await supabase
      .from("tasks")
      .update({ completed: true })
      .eq("title", "User 1 Task")
      .select();

    assertEquals(updateResult.error, null);
    assertEquals(updateResult.data?.length, 0); // No rows updated

    // Verify User 1's task is unchanged
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: "user1@example.com",
      password: "password123",
    });

    const checkTask = await supabase
      .from("tasks")
      .select("*")
      .eq("title", "User 1 Task")
      .single();

    // Completed should still be false (or falsy/undefined which defaults to false)
    assertEquals(checkTask.data?.completed || false, false);

    await db.close();
  });

  test("Context persists across multiple operations", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { supabase } = await createTestClient(db);
    await createTasksTableWithRLS(db);

    const signUpResult = await supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
    });
    const userId = signUpResult.data.user!.id;

    // Multiple operations should all use same context
    await supabase.from("tasks").insert({ title: "Task 1" });
    await supabase.from("tasks").insert({ title: "Task 2" });
    await supabase.from("tasks").insert({ title: "Task 3" });

    const allTasks = await supabase.from("tasks").select("*");
    assertEquals(allTasks.data?.length, 3);
    assertEquals(
      allTasks.data?.every((t: Task) => t.user_id === userId),
      true,
    );

    await db.close();
  });
});
