import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createClient } from "@supabase/supabase-js";
import { test, describe, assertEquals, assertExists } from "./compat.ts";
import { createFetchAdapter } from "../src/client.ts";

const SUPABASE_URL = "http://localhost:54321";

describe("Full User Flow", () => {
  test("Complete auth and RLS lifecycle", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    // Initialize the fetch adapter (this sets up the auth schema)
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // Create schema with RLS-protected table
    await db.exec(`
      CREATE TABLE private_notes (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Enable RLS
      ALTER TABLE private_notes ENABLE ROW LEVEL SECURITY;

      -- Users can only see their own notes
      CREATE POLICY "Users can view own notes"
        ON private_notes
        FOR SELECT
        USING (auth.uid() = user_id);

      -- Users can only insert their own notes
      CREATE POLICY "Users can insert own notes"
        ON private_notes
        FOR INSERT
        WITH CHECK (auth.uid() = user_id);

      -- Users can only update their own notes
      CREATE POLICY "Users can update own notes"
        ON private_notes
        FOR UPDATE
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);

      -- Users can only delete their own notes
      CREATE POLICY "Users can delete own notes"
        ON private_notes
        FOR DELETE
        USING (auth.uid() = user_id);
    `);

    // Create Supabase client
    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Step 1: User signs up
    console.log("Step 1: User signs up");
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: "user@example.com",
      password: "securepassword123",
    });

    assertEquals(signUpError, null, "Sign up should succeed");
    assertExists(signUpData.user, "User should be created");
    assertExists(signUpData.session, "Session should be created");
    const userId = signUpData.user!.id;
    console.log(`✓ User signed up with ID: ${userId}`);

    // Step 2: User creates an RLS-protected entry
    console.log("\nStep 2: User creates an RLS-protected entry");
    const { data: insertData, error: insertError } = await supabase
      .from("private_notes")
      .insert({
        user_id: userId,
        title: "My Secret Note",
        content: "This is private information",
      })
      .select();

    assertEquals(insertError, null, "Insert should succeed when authenticated");
    assertExists(insertData, "Insert should return data");
    assertEquals(insertData.length, 1, "Should insert one row");
    const noteId = insertData[0].id;
    console.log(`✓ Created note with ID: ${noteId}`);

    // Step 3: Verify user can read their own note
    console.log("\nStep 3: Verify user can read their own note");
    const { data: readData, error: readError } = await supabase
      .from("private_notes")
      .select("*")
      .eq("id", noteId);

    assertEquals(readError, null, "Read should succeed for own note");
    assertExists(readData, "Should return data");
    assertEquals(readData.length, 1, "Should return one row");
    assertEquals(readData[0].title, "My Secret Note");
    console.log("✓ User can read their own note");

    // Step 4: User logs out
    console.log("\nStep 4: User logs out");
    const { error: signOutError } = await supabase.auth.signOut();
    assertEquals(signOutError, null, "Sign out should succeed");
    console.log("✓ User signed out successfully");

    // Step 5: Verify anonymous user CANNOT access the protected entry
    console.log("\nStep 5: Verify anonymous user CANNOT access the protected entry");
    const { data: anonReadData, error: anonReadError } = await supabase
      .from("private_notes")
      .select("*")
      .eq("id", noteId);

    // With RLS, anon user should get empty results (not an error)
    assertEquals(anonReadError, null, "Query should not error");
    assertEquals(
      anonReadData?.length || 0,
      0,
      "Anonymous user should not see protected data",
    );
    console.log("✓ Anonymous user cannot access protected entry (RLS working)");

    // Step 6: Verify anonymous user cannot insert
    console.log("\nStep 6: Verify anonymous user cannot insert");
    const { data: anonInsertData, error: anonInsertError } = await supabase
      .from("private_notes")
      .insert({
        user_id: userId,
        title: "Attempted Anon Insert",
        content: "This should fail",
      })
      .select();

    // Should fail or return empty (RLS policy violation)
    if (anonInsertError) {
      console.log("✓ Anonymous insert failed as expected");
    } else {
      assertEquals(
        anonInsertData?.length || 0,
        0,
        "Anonymous insert should not succeed",
      );
      console.log("✓ Anonymous insert blocked by RLS");
    }

    // Step 7: User signs in again
    console.log("\nStep 7: User signs in again");
    const { data: signInData, error: signInError } = await supabase.auth
      .signInWithPassword({
        email: "user@example.com",
        password: "securepassword123",
      });

    assertEquals(signInError, null, "Sign in should succeed");
    assertExists(signInData.user, "User should be authenticated");
    assertExists(signInData.session, "Session should be created");
    console.log("✓ User signed in successfully");

    // Step 8: Verify user can access their note again after signing in
    console.log("\nStep 8: Verify user can access their note after signing in");
    const { data: reReadData, error: reReadError } = await supabase
      .from("private_notes")
      .select("*")
      .eq("id", noteId);

    assertEquals(reReadError, null, "Read should succeed after sign in");
    assertExists(reReadData, "Should return data");
    assertEquals(reReadData.length, 1, "Should return the user's note");
    assertEquals(reReadData[0].title, "My Secret Note");
    console.log("✓ User can access their note after signing back in");

    // Step 9: User updates their note
    console.log("\nStep 9: User updates their note");
    const { data: updateData, error: updateError } = await supabase
      .from("private_notes")
      .update({ title: "Updated Secret Note" })
      .eq("id", noteId)
      .select();

    assertEquals(updateError, null, "Update should succeed");
    assertExists(updateData, "Update should return data");
    assertEquals(updateData[0].title, "Updated Secret Note");
    console.log("✓ User successfully updated their note");

    // Step 10: User deletes their note
    console.log("\nStep 10: User deletes their note");
    const { error: deleteError } = await supabase
      .from("private_notes")
      .delete()
      .eq("id", noteId);

    assertEquals(deleteError, null, "Delete should succeed");
    console.log("✓ User successfully deleted their note");

    // Step 11: Verify note is gone
    console.log("\nStep 11: Verify note is deleted");
    const { data: verifyDeleteData } = await supabase
      .from("private_notes")
      .select("*")
      .eq("id", noteId);

    assertEquals(
      verifyDeleteData?.length || 0,
      0,
      "Note should no longer exist",
    );
    console.log("✓ Note successfully deleted");

    // Step 12: Final sign out
    console.log("\nStep 12: Final sign out");
    const { error: finalSignOutError } = await supabase.auth.signOut();
    assertEquals(finalSignOutError, null, "Final sign out should succeed");
    console.log("✓ User signed out");

    console.log("\n✅ Full user flow completed successfully!");
    console.log("  - User sign up ✓");
    console.log("  - RLS-protected insert ✓");
    console.log("  - User can read own data ✓");
    console.log("  - Anonymous cannot access protected data ✓");
    console.log("  - Anonymous cannot insert ✓");
    console.log("  - User sign in ✓");
    console.log("  - User can update own data ✓");
    console.log("  - User can delete own data ✓");
    console.log("  - User sign out ✓");

    await db.close();
  });
});
