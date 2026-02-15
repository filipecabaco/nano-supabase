/**
 * Integration Tests
 * Tests the full stack: SupabaseClient → PostgrestParser → PGlite
 */

import { PGlite } from "@electric-sql/pglite";
import { createSupabaseClient } from "../src/index.ts";
import {
  test,
  describe,
  assertEquals,
  assertExists,
} from "./compat.ts";

interface User {
  id: number;
  name: string;
  email: string;
  age?: number;
  active?: boolean;
  created_at?: string;
}

interface Task {
  id: number;
  user_id: number;
  title: string;
  description?: string;
  completed: boolean;
  priority?: string;
  due_date?: string;
}

describe("Integration", () => {
  test("Full user CRUD workflow", async () => {
    const db = new PGlite();

    // Create schema
    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INTEGER,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

    const supabase = await createSupabaseClient(db);

    // INSERT
    const { data: insertData, error: insertError } = await supabase
      .from<User>("users")
      .insert({ name: "Alice Johnson", email: "alice@example.com", age: 30 });

    assertEquals(insertError, null);

    // SELECT ALL
    const { data: allUsers, error: selectError } = await supabase
      .from<User[]>("users")
      .select("*");

    assertEquals(selectError, null);
    assertExists(allUsers);
    assertEquals(allUsers.length, 1);
    assertEquals(allUsers[0]?.name, "Alice Johnson");
    assertEquals(allUsers[0]?.email, "alice@example.com");
    assertEquals(allUsers[0]?.age, 30);

    // INSERT MORE
    await supabase
      .from("users")
      .insert({ name: "Bob Smith", email: "bob@example.com", age: 25 });
    await supabase
      .from("users")
      .insert({ name: "Charlie Brown", email: "charlie@example.com", age: 35 });

    // SELECT with filter
    const { data: filtered } = await supabase
      .from<User[]>("users")
      .select("*")
      .gt("age", 28);

    assertEquals(filtered?.length, 2);

    // UPDATE
    const { error: updateError } = await supabase
      .from("users")
      .update({ age: 31 })
      .eq("email", "alice@example.com");

    assertEquals(updateError, null);

    const { data: updated } = await supabase
      .from<User>("users")
      .select("*")
      .eq("email", "alice@example.com")
      .single();

    assertEquals(updated?.age, 31);

    // DELETE
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("email", "bob@example.com");

    assertEquals(deleteError, null);

    const { data: remaining } = await supabase.from<User[]>("users").select("*");
    assertEquals(remaining?.length, 2);

    await db.close();
  });

  test("Complex queries with joins", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    );

    CREATE TABLE tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      completed BOOLEAN DEFAULT false,
      priority TEXT DEFAULT 'medium',
      due_date DATE
    );

    INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com');

    INSERT INTO tasks (user_id, title, completed, priority) VALUES
      (1, 'Task 1', false, 'high'),
      (1, 'Task 2', true, 'low'),
      (2, 'Task 3', false, 'medium');
  `);

    const supabase = await createSupabaseClient(db);

    // Query tasks
    const { data: tasks, error: tasksError } = await supabase
      .from<Task[]>("tasks")
      .select("*")
      .is("completed", false)
      .order("priority", { ascending: false });

    if (tasksError) {
      console.error("Tasks query error:", tasksError);
    }
    assertExists(tasks);
    assertEquals(tasks.length, 2);
    // Priority is TEXT so orders alphabetically DESC: 'medium', 'high'
    assertEquals(tasks[0]?.title, "Task 3"); // medium priority
    assertEquals(tasks[1]?.title, "Task 1"); // high priority

    await db.close();
  });

  test("Filter combinations", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price DECIMAL(10, 2),
      stock INTEGER,
      category TEXT,
      active BOOLEAN DEFAULT true
    );

    INSERT INTO products (name, price, stock, category, active) VALUES
      ('Laptop', 999.99, 10, 'electronics', true),
      ('Mouse', 29.99, 50, 'electronics', true),
      ('Desk', 299.99, 5, 'furniture', true),
      ('Chair', 199.99, 0, 'furniture', false),
      ('Keyboard', 79.99, 20, 'electronics', true);
  `);

    const supabase = await createSupabaseClient(db);

    // Multiple filters
    const { data: electronics, error: electronicsError } = await supabase
      .from<unknown[]>("products")
      .select("*")
      .eq("category", "electronics")
      .is("active", true)
      .gt("stock", 15);

    if (electronicsError) {
      console.error("Electronics query error:", electronicsError);
    }
    assertExists(electronics);
    assertEquals(electronics.length, 2); // Mouse and Keyboard

    // Price range
    const { data: affordable } = await supabase
      .from<unknown[]>("products")
      .select("*")
      .gte("price", 50)
      .lte("price", 300);

    assertExists(affordable);
    assertEquals(affordable.length, 3); // Desk, Chair, Keyboard

    await db.close();
  });

  test("Ordering and pagination", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      published_at TIMESTAMP
    );

    INSERT INTO articles (title, views, published_at) VALUES
      ('Article A', 100, '2024-01-01'),
      ('Article B', 500, '2024-01-02'),
      ('Article C', 200, '2024-01-03'),
      ('Article D', 800, '2024-01-04'),
      ('Article E', 150, '2024-01-05');
  `);

    const supabase = await createSupabaseClient(db);

    // Order by views descending
    const { data: topArticles } = await supabase
      .from<Array<{ title: string; views: number }>>("articles")
      .select("*")
      .order("views", { ascending: false })
      .limit(3);

    assertExists(topArticles);
    assertEquals(topArticles.length, 3);
    assertEquals(topArticles[0]?.title, "Article D"); // 800 views
    assertEquals(topArticles[1]?.title, "Article B"); // 500 views
    assertEquals(topArticles[2]?.title, "Article C"); // 200 views

    // Pagination with range
    const { data: page2 } = await supabase
      .from<Array<{ title: string }>>("articles")
      .select("*")
      .order("id", { ascending: true })
      .range(2, 3); // Items 3 and 4 (0-indexed)

    assertExists(page2);
    assertEquals(page2.length, 2);
    assertEquals(page2[0]?.title, "Article C");
    assertEquals(page2[1]?.title, "Article D");

    await db.close();
  });

  test("Error handling", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL
    )
  `);

    const supabase = await createSupabaseClient(db);

    // Insert duplicate email (should fail)
    await supabase.from("users").insert({ email: "test@example.com" });
    const { error } = await supabase
      .from("users")
      .insert({ email: "test@example.com" });

    assertExists(error);

    // Query non-existent table
    const { error: tableError } = await supabase.from("nonexistent").select("*");
    assertExists(tableError);

    await db.close();
  });

  test("Single and maybeSingle", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL
    );

    INSERT INTO settings (key, value) VALUES
      ('theme', 'dark'),
      ('language', 'en');
  `);

    const supabase = await createSupabaseClient(db);

    // single() - should return single row
    const { data: theme, error: themeError } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "theme")
      .single();

    assertEquals(themeError, null);
    assertExists(theme);
    assertEquals((theme as { value: string }).value, "dark");

    // single() - should error when no rows
    const { error: noRowError } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "nonexistent")
      .single();

    assertExists(noRowError);

    // maybeSingle() - should return null when no rows
    const { data: maybe, error: maybeError } = await supabase
      .from("settings")
      .select("*")
      .eq("key", "nonexistent")
      .maybeSingle();

    assertEquals(maybeError, null);
    assertEquals(maybe, null);

    await db.close();
  });

  test("String operations", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT
    );

    INSERT INTO posts (title, content) VALUES
      ('Hello World', 'First post content'),
      ('Getting Started', 'Tutorial content'),
      ('Advanced Topics', 'Advanced content'),
      ('Hello Again', 'Another hello post');
  `);

    const supabase = await createSupabaseClient(db);

    // LIKE
    const { data: helloLike } = await supabase
      .from<unknown[]>("posts")
      .select("*")
      .like("title", "Hello%");

    assertExists(helloLike);
    assertEquals(helloLike.length, 2);

    // ILIKE (case-insensitive)
    const { data: helloIlike } = await supabase
      .from<unknown[]>("posts")
      .select("*")
      .ilike("title", "hello%");

    assertExists(helloIlike);
    assertEquals(helloIlike.length, 2);

    await db.close();
  });

  test("IN and IS operators", async () => {
    const db = new PGlite();

    await db.exec(`
    CREATE TABLE items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT,
      deleted_at TIMESTAMP
    );

    INSERT INTO items (name, status, deleted_at) VALUES
      ('Item 1', 'active', NULL),
      ('Item 2', 'pending', NULL),
      ('Item 3', 'active', NULL),
      ('Item 4', 'inactive', '2024-01-01');
  `);

    const supabase = await createSupabaseClient(db);

    // IN operator
    const { data: activeOrPending } = await supabase
      .from<unknown[]>("items")
      .select("*")
      .in("status", ["active", "pending"]);

    assertExists(activeOrPending);
    assertEquals(activeOrPending.length, 3);

    // IS NULL
    const { data: notDeleted } = await supabase
      .from<unknown[]>("items")
      .select("*")
      .is("deleted_at", null);

    assertExists(notDeleted);
    assertEquals(notDeleted.length, 3);

    await db.close();
  });

  test("Complete real-world scenario", async () => {
    const db = new PGlite();

    // Create a blog schema
    await db.exec(`
    CREATE TABLE authors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      bio TEXT,
      active BOOLEAN DEFAULT true
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      published BOOLEAN DEFAULT false,
      views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

    const supabase = await createSupabaseClient(db);

    // 1. Create authors
    await supabase.from("authors").insert({
      name: "Jane Doe",
      email: "jane@example.com",
      bio: "Tech blogger",
    });

    const { data: author } = await supabase
      .from("authors")
      .select("*")
      .eq("email", "jane@example.com")
      .single();

    assertExists(author);
    const authorId = (author as { id: number }).id;

    // 2. Create posts
    await supabase.from("posts").insert({
      author_id: authorId,
      title: "Introduction to PGlite",
      content: "PGlite is amazing!",
      published: true,
      views: 100,
    });

    await supabase.from("posts").insert({
      author_id: authorId,
      title: "Advanced PGlite Usage",
      content: "Deep dive into PGlite",
      published: false,
      views: 0,
    });

    // 3. Query published posts
    const { data: publishedPosts } = await supabase
      .from<Array<{ id: number; title: string }>>("posts")
      .select("*")
      .is("published", true)
      .eq("author_id", authorId);

    assertExists(publishedPosts);
    assertEquals(publishedPosts.length, 1);
    assertEquals(publishedPosts[0]?.title, "Introduction to PGlite");

    // 4. Add comments
    const postId = publishedPosts[0]?.id;
    await supabase.from("comments").insert({
      post_id: postId,
      author_name: "Reader 1",
      content: "Great article!",
    });

    await supabase.from("comments").insert({
      post_id: postId,
      author_name: "Reader 2",
      content: "Very helpful, thanks!",
    });

    // 5. Get comment count
    const { data: comments } = await supabase
      .from<unknown[]>("comments")
      .select("*")
      .eq("post_id", postId);

    assertExists(comments);
    assertEquals(comments.length, 2);

    // 6. Update post views
    await supabase.from("posts").update({ views: 150 }).eq("id", postId);

    const { data: updatedPost } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    assertEquals((updatedPost as { views: number }).views, 150);

    // 7. Deactivate author (soft delete)
    await supabase.from("authors").update({ active: false }).eq("id", authorId);

    const { data: inactiveAuthor } = await supabase
      .from("authors")
      .select("*")
      .eq("id", authorId)
      .single();

    assertEquals((inactiveAuthor as { active: boolean }).active, false);

    await db.close();
  });
});
