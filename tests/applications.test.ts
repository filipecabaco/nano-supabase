/**
 * Application Tests
 *
 * Emulated real-world application scenarios that exercise auth + data + storage + RLS
 * together, as a developer building on nano-supabase would actually use them.
 *
 * Each test simulates a complete mini-application with schema, users, and workflows.
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createClient } from "@supabase/supabase-js";
import {
  test,
  describe,
  assertEquals,
  assertExists,
} from "./compat.ts";
import { createFetchAdapter } from "../src/client.ts";

const SUPABASE_URL = "http://localhost:54321";

async function createApp() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const { localFetch } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  });

  const client = (email?: string, password?: string) => {
    const c = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    return c;
  };

  return { db, localFetch, client };
}

describe("Image Gallery App", () => {
  test("Artist uploads images, links metadata, browses gallery, deletes an image", async () => {
    const { db, localFetch, client } = await createApp();

    const supabase = client();

    const { data: authData } = await supabase.auth.signUp({
      email: "artist@gallery.com",
      password: "gallery123",
    });
    const userId = authData.user!.id;

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
      GRANT ALL ON gallery TO authenticated;
    `);

    await supabase.storage.createBucket("gallery-images", { public: true });

    const images = [
      { name: "sunset.jpg", content: "sunset-data" },
      { name: "mountain.jpg", content: "mountain-data" },
      { name: "ocean.jpg", content: "ocean-data" },
    ];

    for (const img of images) {
      const storagePath = `${userId}/${img.name}`;

      const { error: upErr } = await supabase.storage
        .from("gallery-images")
        .upload(storagePath, new TextEncoder().encode(img.content), {
          contentType: "image/jpeg",
        });
      assertEquals(upErr, null);

      const { error: insertErr } = await supabase.from("gallery").insert({
        user_id: userId,
        title: img.name.replace(".jpg", ""),
        storage_path: storagePath,
      });
      assertEquals(insertErr, null);
    }

    const { data: galleryData, error: galleryErr } = await supabase
      .from("gallery")
      .select("*")
      .order("created_at", { ascending: true });

    assertEquals(galleryErr, null);
    assertEquals(galleryData!.length, 3);

    for (const entry of galleryData!) {
      const { data: urlData } = supabase.storage
        .from("gallery-images")
        .getPublicUrl(entry.storage_path);
      assertExists(urlData.publicUrl);
    }

    const publicRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/gallery-images/${userId}/sunset.jpg`,
      { method: "GET" },
    );
    assertEquals(publicRes.status, 200);
    assertEquals(await publicRes.text(), "sunset-data");

    const { error: removeErr } = await supabase.storage
      .from("gallery-images")
      .remove([`${userId}/ocean.jpg`]);
    assertEquals(removeErr, null);

    const { error: deleteErr } = await supabase
      .from("gallery")
      .delete()
      .eq("title", "ocean");
    assertEquals(deleteErr, null);

    const { data: remaining } = await supabase.from("gallery").select("*");
    assertEquals(remaining!.length, 2);

    await db.close();
  });
});

describe("Social Media App", () => {
  test("Users create profiles, post with images, comment, and browse as anonymous", async () => {
    const { db, localFetch, client } = await createApp();

    // Schema
    await db.exec(`
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

    // Setup buckets
    const setup = client();
    await setup.auth.signUp({ email: "setup@social.app", password: "setup123" });
    await setup.storage.createBucket("post-images", { public: true });
    await setup.storage.createBucket("avatars", { public: true });
    await setup.auth.signOut();

    // Alice signs up, creates profile and post
    const alice = client();
    const { data: aliceAuth } = await alice.auth.signUp({
      email: "alice@social.app",
      password: "alice123",
    });
    const aliceId = aliceAuth.user!.id;

    const { error: avatarErr } = await alice.storage
      .from("avatars")
      .upload(
        `${aliceId}/avatar.jpg`,
        new TextEncoder().encode("ALICE_AVATAR_DATA"),
        { contentType: "image/jpeg" },
      );
    assertEquals(avatarErr, null);

    const { data: avatarUrl } = alice.storage
      .from("avatars")
      .getPublicUrl(`${aliceId}/avatar.jpg`);

    const { error: profileErr } = await alice.from("profiles").insert({
      id: aliceId,
      username: "alice",
      avatar_url: avatarUrl.publicUrl,
      bio: "I love coding!",
    });
    assertEquals(profileErr, null);

    const { error: imgUpErr } = await alice.storage
      .from("post-images")
      .upload(
        `${aliceId}/sunset-at-beach.jpg`,
        new TextEncoder().encode("SUNSET_IMAGE_BYTES"),
        { contentType: "image/jpeg" },
      );
    assertEquals(imgUpErr, null);

    const { error: postErr } = await alice.from("posts").insert({
      author_id: aliceId,
      content: "Beautiful sunset at the beach!",
      image_path: `${aliceId}/sunset-at-beach.jpg`,
    });
    assertEquals(postErr, null);

    const { data: alicePosts } = await alice
      .from("posts")
      .select("*")
      .eq("author_id", aliceId);
    assertExists(alicePosts);
    const alicePostId = alicePosts![0].id;

    // Bob signs up and interacts
    const bob = client();
    const { data: bobAuth } = await bob.auth.signUp({
      email: "bob@social.app",
      password: "bob123",
    });
    const bobId = bobAuth.user!.id;

    await bob.from("profiles").insert({
      id: bobId,
      username: "bob",
      bio: "Photography enthusiast",
    });

    // Bob reads the feed
    const { data: feed, error: feedErr } = await bob
      .from("posts")
      .select("*")
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

    // Bob downloads Alice's post image
    const publicImgRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/post-images/${aliceId}/sunset-at-beach.jpg`,
      { method: "GET" },
    );
    assertEquals(publicImgRes.status, 200);
    assertEquals(await publicImgRes.text(), "SUNSET_IMAGE_BYTES");

    // Bob creates his own post
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

    // Anonymous user browses
    const anon = client();

    const { data: anonFeed, error: anonFeedErr } = await anon
      .from("posts")
      .select("*");
    assertEquals(anonFeedErr, null);
    assertEquals(anonFeed!.length, 2);

    const { data: anonComments } = await anon
      .from("comments")
      .select("*")
      .eq("post_id", alicePostId);
    assertExists(anonComments);
    assertEquals(anonComments!.length, 1);

    const { data: anonProfiles } = await anon
      .from("profiles")
      .select("username, bio");
    assertEquals(anonProfiles!.length >= 2, true);

    const anonImgRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/post-images/${bobId}/coffee-shop.jpg`,
      { method: "GET" },
    );
    assertEquals(anonImgRes.status, 200);
    assertEquals(await anonImgRes.text(), "COFFEE_SHOP_BYTES");

    // Anon CANNOT insert posts
    const { error: anonPostErr } = await anon.from("posts").insert({
      author_id: aliceId,
      content: "Spam!",
    });
    assertExists(anonPostErr);

    // Alice deletes her post (cascade deletes comments)
    const aliceAgain = client();
    await aliceAgain.auth.signInWithPassword({
      email: "alice@social.app",
      password: "alice123",
    });

    const { error: deletePostErr } = await aliceAgain
      .from("posts")
      .delete()
      .eq("id", alicePostId);
    assertEquals(deletePostErr, null);

    const { error: deleteImgErr } = await aliceAgain.storage
      .from("post-images")
      .remove([`${aliceId}/sunset-at-beach.jpg`]);
    assertEquals(deleteImgErr, null);

    const { data: deletedComments } = await aliceAgain
      .from("comments")
      .select("*")
      .eq("post_id", alicePostId);
    assertEquals(deletedComments!.length, 0);

    const { data: remainingPosts } = await aliceAgain
      .from("posts")
      .select("*");
    assertEquals(remainingPosts!.length, 1);

    await db.close();
  });
});

describe("Todo App", () => {
  test("Multi-user task management with categories and RLS", async () => {
    const { db, client } = await createApp();

    await db.exec(`
      CREATE TABLE categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#808080',
        UNIQUE(user_id, name)
      );
      ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users manage own categories"
        ON categories FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
      GRANT ALL ON categories TO authenticated;

      CREATE TABLE todos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        category_id UUID REFERENCES categories(id),
        title TEXT NOT NULL,
        done BOOLEAN DEFAULT false,
        due_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Users manage own todos"
        ON todos FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
      GRANT ALL ON todos TO authenticated;
    `);

    // Alice sets up her workspace
    const alice = client();
    const { data: aliceAuth } = await alice.auth.signUp({
      email: "alice@todo.app",
      password: "alice123",
    });
    const aliceId = aliceAuth.user!.id;

    await alice.from("categories").insert([
      { user_id: aliceId, name: "Work", color: "#FF0000" },
      { user_id: aliceId, name: "Personal", color: "#00FF00" },
    ]);

    const { data: aliceCategories } = await alice.from("categories").select("*");
    assertEquals(aliceCategories!.length, 2);

    const workCat = aliceCategories!.find((c: { name: string }) => c.name === "Work");
    const personalCat = aliceCategories!.find((c: { name: string }) => c.name === "Personal");

    await alice.from("todos").insert([
      { user_id: aliceId, category_id: workCat.id, title: "Ship feature", due_date: "2026-03-01" },
      { user_id: aliceId, category_id: workCat.id, title: "Code review", due_date: "2026-02-20" },
      { user_id: aliceId, category_id: personalCat.id, title: "Buy groceries" },
    ]);

    // Alice filters by category
    const { data: workTodos } = await alice
      .from("todos")
      .select("*")
      .eq("category_id", workCat.id);
    assertEquals(workTodos!.length, 2);

    // Alice completes a todo
    await alice
      .from("todos")
      .update({ done: true })
      .eq("title", "Code review");

    const { data: allTodos } = await alice.from("todos").select("*");
    const doneTodos = allTodos!.filter((t: { done: boolean }) => t.done);
    assertEquals(doneTodos.length, 1);
    assertEquals(doneTodos[0].title, "Code review");

    // Bob signs up — sees nothing
    const bob = client();
    const { data: bobAuth } = await bob.auth.signUp({
      email: "bob@todo.app",
      password: "bob123",
    });
    const bobId = bobAuth.user!.id;

    const { data: bobTodos } = await bob.from("todos").select("*");
    assertEquals(bobTodos!.length, 0);

    const { data: bobCategories } = await bob.from("categories").select("*");
    assertEquals(bobCategories!.length, 0);

    // Bob creates his own
    await bob.from("categories").insert({ user_id: bobId, name: "Urgent", color: "#FF0000" });
    await bob.from("todos").insert({ user_id: bobId, title: "Fix production bug" });

    const { data: bobAllTodos } = await bob.from("todos").select("*");
    assertEquals(bobAllTodos!.length, 1);

    // Alice still sees only her 3
    const { data: aliceAllTodos } = await alice.from("todos").select("*");
    assertEquals(aliceAllTodos!.length, 3);

    // Alice deletes a todo
    await alice.from("todos").delete().eq("title", "Buy groceries");
    const { data: afterDelete } = await alice.from("todos").select("*");
    assertEquals(afterDelete!.length, 2);

    await db.close();
  });
});
