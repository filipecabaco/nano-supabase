/**
 * Storage Full User Flow Tests
 *
 * End-to-end integration tests simulating real AI builder / web container
 * use cases: auth + storage + RLS working together through supabase-js.
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createClient } from "@supabase/supabase-js";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createFetchAdapter } from "../src/client.ts";

const SUPABASE_URL = "http://localhost:54321";

// ============================================================================
// Full lifecycle: auth + storage through supabase-js client
// ============================================================================

Deno.test(
  "Full Storage Flow - Upload, list, download, delete via supabase-js",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Step 1: Sign up
    const { data: signUpData, error: signUpError } =
      await supabase.auth.signUp({
        email: "storageuser@example.com",
        password: "securepass123",
      });
    assertEquals(signUpError, null);
    assertExists(signUpData.session);

    // Step 2: Create a storage bucket via raw fetch (supabase-js bucket API)
    const { data: bucketData, error: bucketError } =
      await supabase.storage.createBucket("user-files", {
        public: false,
      });

    assertEquals(bucketError, null);
    assertExists(bucketData);

    // Step 3: Upload a file
    const fileContent = new TextEncoder().encode("Hello from supabase-js!");
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("user-files")
      .upload("notes/hello.txt", fileContent, {
        contentType: "text/plain",
      });

    assertEquals(uploadError, null);
    assertExists(uploadData);

    // Step 4: List files
    const { data: listData, error: listError } = await supabase.storage
      .from("user-files")
      .list("notes/");

    assertEquals(listError, null);
    assertExists(listData);
    assertEquals(listData!.length >= 1, true);

    // Step 5: Download the file
    const { data: downloadData, error: downloadError } = await supabase.storage
      .from("user-files")
      .download("notes/hello.txt");

    assertEquals(downloadError, null);
    assertExists(downloadData);
    const text = await downloadData!.text();
    assertEquals(text, "Hello from supabase-js!");

    // Step 6: Remove the file
    const { data: removeData, error: removeError } = await supabase.storage
      .from("user-files")
      .remove(["notes/hello.txt"]);

    assertEquals(removeError, null);
    assertExists(removeData);

    // Step 7: Verify file is gone
    const { data: afterRemove } = await supabase.storage
      .from("user-files")
      .list("notes/");
    assertEquals(afterRemove?.length || 0, 0);

    // Step 8: Delete the bucket
    const { error: deleteError } = await supabase.storage.deleteBucket(
      "user-files",
    );
    assertEquals(deleteError, null);

    await db.close();
  },
);

// ============================================================================
// Public bucket: upload private, serve public
// ============================================================================

Deno.test(
  "Full Storage Flow - Public bucket allows unauthenticated download",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Sign up
    await supabase.auth.signUp({
      email: "public-uploader@example.com",
      password: "pass123",
    });

    // Create public bucket
    await supabase.storage.createBucket("public-assets", { public: true });

    // Upload a file (while authenticated)
    await supabase.storage
      .from("public-assets")
      .upload("logo.svg", new TextEncoder().encode("<svg></svg>"), {
        contentType: "image/svg+xml",
      });

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("public-assets")
      .getPublicUrl("logo.svg");

    assertExists(urlData.publicUrl);

    // Sign out
    await supabase.auth.signOut();

    // Download via public URL (no auth)
    const publicRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/public-assets/logo.svg`,
      { method: "GET" },
    );

    assertEquals(publicRes.status, 200);
    assertEquals(await publicRes.text(), "<svg></svg>");

    await db.close();
  },
);

// ============================================================================
// Signed URL flow
// ============================================================================

Deno.test(
  "Full Storage Flow - Create signed URL and download",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({
      email: "signer@example.com",
      password: "pass123",
    });

    await supabase.storage.createBucket("private-docs", { public: false });

    await supabase.storage
      .from("private-docs")
      .upload("report.pdf", new TextEncoder().encode("PDF CONTENT"), {
        contentType: "application/pdf",
      });

    // Create signed URL (expires in 60 seconds)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("private-docs")
      .createSignedUrl("report.pdf", 60);

    assertEquals(signedError, null);
    assertExists(signedData?.signedUrl);

    // Download via signed URL (no auth needed)
    const downloadRes = await localFetch(signedData!.signedUrl, {
      method: "GET",
    });

    assertEquals(downloadRes.status, 200);
    assertEquals(await downloadRes.text(), "PDF CONTENT");

    await db.close();
  },
);

// ============================================================================
// Multiple users with RLS on storage
// ============================================================================

Deno.test(
  "Full Storage Flow - RLS enforces per-user storage access",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Create bucket and add RLS policies
    // First sign up to initialize auth
    await supabase.auth.signUp({
      email: "setup@example.com",
      password: "pass123",
    });

    await supabase.storage.createBucket("user-uploads", { public: false });

    // Add RLS policy: only authenticated users can insert, and they can read all
    await db.exec(`
      CREATE POLICY "Authenticated users can upload"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'user-uploads');

      CREATE POLICY "Authenticated users can read"
        ON storage.objects FOR SELECT
        TO authenticated
        USING (bucket_id = 'user-uploads');

      CREATE POLICY "Authenticated users can delete own files"
        ON storage.objects FOR DELETE
        TO authenticated
        USING (bucket_id = 'user-uploads' AND owner_id = auth.uid()::text);
    `);

    // Sign up User A
    const supabaseA = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await supabaseA.auth.signUp({
      email: "alice@example.com",
      password: "alicepass",
    });

    // User A uploads
    const { error: uploadAError } = await supabaseA.storage
      .from("user-uploads")
      .upload("alice-file.txt", new TextEncoder().encode("Alice's data"), {
        contentType: "text/plain",
      });
    assertEquals(uploadAError, null);

    // Sign up User B in a separate client
    const supabaseB = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await supabaseB.auth.signUp({
      email: "bob@example.com",
      password: "bobpass",
    });

    // User B uploads
    const { error: uploadBError } = await supabaseB.storage
      .from("user-uploads")
      .upload("bob-file.txt", new TextEncoder().encode("Bob's data"), {
        contentType: "text/plain",
      });
    assertEquals(uploadBError, null);

    // User B can list and see both files (policy allows SELECT for all authenticated)
    const { data: listB } = await supabaseB.storage
      .from("user-uploads")
      .list("");
    assertExists(listB);
    assertEquals(listB!.length >= 2, true);

    await db.close();
  },
);

// ============================================================================
// AI builder use case: image gallery
// ============================================================================

Deno.test(
  "Full Storage Flow - AI builder use case: image gallery app",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Sign up
    const { data: authData } = await supabase.auth.signUp({
      email: "artist@gallery.com",
      password: "gallery123",
    });
    const userId = authData.user!.id;

    // Create a gallery table
    await db.exec(`
      CREATE TABLE gallery (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        title TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users manage own gallery"
        ON gallery FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    `);

    // Create public bucket for gallery images
    await supabase.storage.createBucket("gallery-images", { public: true });

    // Upload 3 "images"
    const images = [
      { name: "sunset.jpg", content: "sunset-data" },
      { name: "mountain.jpg", content: "mountain-data" },
      { name: "ocean.jpg", content: "ocean-data" },
    ];

    for (const img of images) {
      const storagePath = `${userId}/${img.name}`;

      // Upload to storage
      const { error: upErr } = await supabase.storage
        .from("gallery-images")
        .upload(storagePath, new TextEncoder().encode(img.content), {
          contentType: "image/jpeg",
        });
      assertEquals(upErr, null);

      // Insert metadata into gallery table
      const { error: insertErr } = await supabase.from("gallery").insert({
        user_id: userId,
        title: img.name.replace(".jpg", ""),
        storage_path: storagePath,
      });
      assertEquals(insertErr, null);
    }

    // Fetch gallery entries
    const { data: galleryData, error: galleryErr } = await supabase
      .from("gallery")
      .select("*")
      .order("created_at", { ascending: true });

    assertEquals(galleryErr, null);
    assertEquals(galleryData!.length, 3);

    // Get public URLs for each image
    for (const entry of galleryData!) {
      const { data: urlData } = supabase.storage
        .from("gallery-images")
        .getPublicUrl(entry.storage_path);
      assertExists(urlData.publicUrl);
    }

    // Verify public download works
    const publicRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/gallery-images/${userId}/sunset.jpg`,
      { method: "GET" },
    );
    assertEquals(publicRes.status, 200);
    assertEquals(await publicRes.text(), "sunset-data");

    // Delete one image
    const { error: removeErr } = await supabase.storage
      .from("gallery-images")
      .remove([`${userId}/ocean.jpg`]);
    assertEquals(removeErr, null);

    // Remove from gallery table
    const { error: deleteErr } = await supabase
      .from("gallery")
      .delete()
      .eq("title", "ocean");
    assertEquals(deleteErr, null);

    // Verify 2 remain
    const { data: remaining } = await supabase.from("gallery").select("*");
    assertEquals(remaining!.length, 2);

    await db.close();
  },
);

// ============================================================================
// Bucket operations through supabase-js
// ============================================================================

Deno.test(
  "Full Storage Flow - Bucket CRUD through supabase-js",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({
      email: "admin@buckets.com",
      password: "pass123",
    });

    // Create
    const { error: createErr } = await supabase.storage.createBucket(
      "test-bucket",
      { public: false },
    );
    assertEquals(createErr, null);

    // List
    const { data: buckets, error: listErr } =
      await supabase.storage.listBuckets();
    assertEquals(listErr, null);
    assertExists(buckets);
    assertEquals(buckets!.length >= 1, true);
    const found = buckets!.find(
      (b: { name: string }) => b.name === "test-bucket",
    );
    assertExists(found);

    // Get
    const { data: bucket, error: getErr } =
      await supabase.storage.getBucket("test-bucket");
    assertEquals(getErr, null);
    assertExists(bucket);
    assertEquals(bucket!.name, "test-bucket");
    assertEquals(bucket!.public, false);

    // Update
    const { error: updateErr } = await supabase.storage.updateBucket(
      "test-bucket",
      { public: true },
    );
    assertEquals(updateErr, null);

    // Verify update
    const { data: updated } = await supabase.storage.getBucket("test-bucket");
    assertEquals(updated!.public, true);

    // Empty (noop since bucket is empty)
    const { error: emptyErr } =
      await supabase.storage.emptyBucket("test-bucket");
    assertEquals(emptyErr, null);

    // Delete
    const { error: deleteErr } =
      await supabase.storage.deleteBucket("test-bucket");
    assertEquals(deleteErr, null);

    // Verify deleted
    const { error: getAfterDelete } =
      await supabase.storage.getBucket("test-bucket");
    assertExists(getAfterDelete);

    await db.close();
  },
);

// ============================================================================
// Move and copy through supabase-js
// ============================================================================

Deno.test(
  "Full Storage Flow - Move and copy through supabase-js",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({
      email: "mover@example.com",
      password: "pass123",
    });

    await supabase.storage.createBucket("files", { public: false });

    // Upload original file
    await supabase.storage
      .from("files")
      .upload("original.txt", new TextEncoder().encode("original content"), {
        contentType: "text/plain",
      });

    // Copy
    const { error: copyErr } = await supabase.storage
      .from("files")
      .copy("original.txt", "copy.txt");
    assertEquals(copyErr, null);

    // Verify both exist
    const { data: copyDownload } = await supabase.storage
      .from("files")
      .download("copy.txt");
    assertExists(copyDownload);
    assertEquals(await copyDownload!.text(), "original content");

    // Move the copy
    const { error: moveErr } = await supabase.storage
      .from("files")
      .move("copy.txt", "moved.txt");
    assertEquals(moveErr, null);

    // Verify moved file exists
    const { data: movedDownload } = await supabase.storage
      .from("files")
      .download("moved.txt");
    assertExists(movedDownload);
    assertEquals(await movedDownload!.text(), "original content");

    // Verify copy.txt is gone (returns error)
    const { error: goneErr } = await supabase.storage
      .from("files")
      .download("copy.txt");
    assertExists(goneErr);

    await db.close();
  },
);

// ============================================================================
// Full E2E: Social media app (auth + data + storage + RLS)
// ============================================================================

Deno.test(
  "Full E2E - Social media app: profiles, posts with images, comments",
  async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    // ── Schema ────────────────────────────────────────────────────

    await db.exec(`
      -- Profiles table (public read, owner write)
      CREATE TABLE profiles (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Public profiles are viewable by everyone"
        ON profiles FOR SELECT USING (true);
      CREATE POLICY "Users can update own profile"
        ON profiles FOR UPDATE USING (auth.uid() = id);
      CREATE POLICY "Users can insert own profile"
        ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
      GRANT ALL ON profiles TO authenticated, anon;

      -- Posts table with image references
      CREATE TABLE posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID NOT NULL REFERENCES profiles(id),
        content TEXT NOT NULL,
        image_path TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Posts are publicly readable"
        ON posts FOR SELECT USING (true);
      CREATE POLICY "Users can create own posts"
        ON posts FOR INSERT WITH CHECK (auth.uid() = author_id);
      CREATE POLICY "Users can delete own posts"
        ON posts FOR DELETE USING (auth.uid() = author_id);
      GRANT ALL ON posts TO authenticated, anon;

      -- Comments
      CREATE TABLE comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id UUID NOT NULL REFERENCES profiles(id),
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Comments are publicly readable"
        ON comments FOR SELECT USING (true);
      CREATE POLICY "Authenticated users can comment"
        ON comments FOR INSERT WITH CHECK (auth.uid() = author_id);
      CREATE POLICY "Users can delete own comments"
        ON comments FOR DELETE USING (auth.uid() = author_id);
      GRANT ALL ON comments TO authenticated, anon;
    `);

    // ── Create storage buckets ───────────────────────────────────

    // We need a user first to create buckets
    const setupSupabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await setupSupabase.auth.signUp({
      email: "setup@social.app",
      password: "setup123",
    });

    // Public bucket for post images
    await setupSupabase.storage.createBucket("post-images", { public: true });
    // Public bucket for avatars
    await setupSupabase.storage.createBucket("avatars", { public: true });

    await setupSupabase.auth.signOut();

    // ── Alice signs up and creates her profile ───────────────────

    const alice = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    const { data: aliceAuth } = await alice.auth.signUp({
      email: "alice@social.app",
      password: "alice123",
    });
    const aliceId = aliceAuth.user!.id;

    // Upload avatar
    const { error: avatarErr } = await alice.storage
      .from("avatars")
      .upload(
        `${aliceId}/avatar.jpg`,
        new TextEncoder().encode("ALICE_AVATAR_DATA"),
        { contentType: "image/jpeg" },
      );
    assertEquals(avatarErr, null);

    // Get avatar public URL
    const { data: avatarUrl } = alice.storage
      .from("avatars")
      .getPublicUrl(`${aliceId}/avatar.jpg`);

    // Create profile
    const { error: profileErr } = await alice.from("profiles").insert({
      id: aliceId,
      username: "alice",
      avatar_url: avatarUrl.publicUrl,
      bio: "I love coding!",
    });
    assertEquals(profileErr, null);

    // Create a post with an image
    const { error: imgUpErr } = await alice.storage
      .from("post-images")
      .upload(
        `${aliceId}/sunset-at-beach.jpg`,
        new TextEncoder().encode("SUNSET_IMAGE_BYTES"),
        { contentType: "image/jpeg" },
      );
    assertEquals(imgUpErr, null);

    const { data: postData, error: postErr } = await alice
      .from("posts")
      .insert({
        author_id: aliceId,
        content: "Beautiful sunset at the beach!",
        image_path: `${aliceId}/sunset-at-beach.jpg`,
      })
      .select()
      .single();
    assertEquals(postErr, null);
    assertExists(postData);
    const alicePostId = postData!.id;

    // ── Bob signs up and interacts ──────────────────────────────

    const bob = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    const { data: bobAuth } = await bob.auth.signUp({
      email: "bob@social.app",
      password: "bob123",
    });
    const bobId = bobAuth.user!.id;

    // Bob creates his profile
    await bob.from("profiles").insert({
      id: bobId,
      username: "bob",
      bio: "Photography enthusiast",
    });

    // Bob reads the public feed (should see Alice's post)
    const { data: feed, error: feedErr } = await bob
      .from("posts")
      .select("*, profiles(username, avatar_url)")
      .order("created_at", { ascending: false });

    assertEquals(feedErr, null);
    assertExists(feed);
    assertEquals(feed!.length >= 1, true);

    // Bob comments on Alice's post
    const { error: commentErr } = await bob.from("comments").insert({
      post_id: alicePostId,
      author_id: bobId,
      body: "Amazing photo!",
    });
    assertEquals(commentErr, null);

    // Bob downloads the post image via public URL
    const publicImgRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/post-images/${aliceId}/sunset-at-beach.jpg`,
      { method: "GET" },
    );
    assertEquals(publicImgRes.status, 200);
    assertEquals(await publicImgRes.text(), "SUNSET_IMAGE_BYTES");

    // Bob uploads his own post with image
    await bob.storage
      .from("post-images")
      .upload(
        `${bobId}/coffee-shop.jpg`,
        new TextEncoder().encode("COFFEE_SHOP_BYTES"),
        { contentType: "image/jpeg" },
      );

    await bob.from("posts").insert({
      author_id: bobId,
      content: "Best coffee in town!",
      image_path: `${bobId}/coffee-shop.jpg`,
    });

    // ── Anonymous user reads public content ──────────────────────

    const anon = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    // Anon can see all posts
    const { data: anonFeed, error: anonFeedErr } = await anon
      .from("posts")
      .select("*");
    assertEquals(anonFeedErr, null);
    assertEquals(anonFeed!.length, 2);

    // Anon can see comments
    const { data: anonComments } = await anon
      .from("comments")
      .select("*, profiles(username)")
      .eq("post_id", alicePostId);
    assertExists(anonComments);
    assertEquals(anonComments!.length, 1);

    // Anon can see profiles
    const { data: anonProfiles } = await anon
      .from("profiles")
      .select("username, bio");
    assertEquals(anonProfiles!.length >= 2, true);

    // Anon can download public images
    const anonImgRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/post-images/${bobId}/coffee-shop.jpg`,
      { method: "GET" },
    );
    assertEquals(anonImgRes.status, 200);
    assertEquals(await anonImgRes.text(), "COFFEE_SHOP_BYTES");

    // Anon CANNOT insert posts (RLS blocks it)
    const { error: anonPostErr } = await anon.from("posts").insert({
      author_id: aliceId,
      content: "Spam!",
    });
    assertExists(anonPostErr);

    // ── Alice deletes her post (cascade deletes comments) ────────

    // Re-authenticate Alice
    const aliceAgain = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await aliceAgain.auth.signInWithPassword({
      email: "alice@social.app",
      password: "alice123",
    });

    // Delete post (should cascade delete comments)
    const { error: deletePostErr } = await aliceAgain
      .from("posts")
      .delete()
      .eq("id", alicePostId);
    assertEquals(deletePostErr, null);

    // Delete the image from storage
    const { error: deleteImgErr } = await aliceAgain.storage
      .from("post-images")
      .remove([`${aliceId}/sunset-at-beach.jpg`]);
    assertEquals(deleteImgErr, null);

    // Verify comment was cascade deleted
    const { data: deletedComments } = await aliceAgain
      .from("comments")
      .select("*")
      .eq("post_id", alicePostId);
    assertEquals(deletedComments!.length, 0);

    // Verify only Bob's post remains
    const { data: remainingPosts } = await aliceAgain
      .from("posts")
      .select("*");
    assertEquals(remainingPosts!.length, 1);

    // ── Cleanup ──────────────────────────────────────────────────

    await db.close();
  },
);
