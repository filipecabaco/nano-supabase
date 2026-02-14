/**
 * Storage Integration Tests
 *
 * Tests the local Supabase Storage emulation via the fetch adapter.
 * Covers bucket CRUD, object upload/download/list/move/copy/remove,
 * signed URLs, public downloads, and RLS enforcement.
 */

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createFetchAdapter } from "../src/client.ts";
import {
  test,
  describe,
  assertEquals,
  assertExists,
} from "./compat.ts";

const SUPABASE_URL = "http://localhost:54321";

// ============================================================================
// Helper: sign up and get access token
// ============================================================================

async function signUp(
  localFetch: typeof fetch,
  email = "user@test.com",
  password = "password123",
) {
  const res = await localFetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return await res.json();
}

// ============================================================================
// Bucket CRUD
// ============================================================================

describe("Storage Buckets", () => {
  test("Create bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "avatars", public: false }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.name, "avatars");

    await db.close();
  });

  test("Create public bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "public-assets", public: true }),
    });

    assertEquals(res.status, 200);

    // Verify it's public
    const getRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/public-assets`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    const bucket = await getRes.json();
    assertEquals(bucket.public, true);

    await db.close();
  });

  test("List buckets", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    // Create two buckets
    for (const name of ["bucket-a", "bucket-b"]) {
      await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ name }),
      });
    }

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "GET",
      headers: { Authorization: `Bearer ${auth.access_token}` },
    });

    assertEquals(res.status, 200);
    const buckets = await res.json();
    assertEquals(buckets.length, 2);

    await db.close();
  });

  test("Get bucket by ID", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "my-bucket" }),
    });

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket/my-bucket`, {
      method: "GET",
      headers: { Authorization: `Bearer ${auth.access_token}` },
    });

    assertEquals(res.status, 200);
    const bucket = await res.json();
    assertEquals(bucket.name, "my-bucket");
    assertEquals(bucket.public, false);

    await db.close();
  });

  test("Get nonexistent bucket returns 404", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/nonexistent`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 404);

    await db.close();
  });

  test("Update bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "update-me" }),
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/update-me`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ public: true, file_size_limit: 5242880 }),
      },
    );

    assertEquals(res.status, 200);

    // Verify update
    const getRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/update-me`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    const bucket = await getRes.json();
    assertEquals(bucket.public, true);
    assertEquals(bucket.file_size_limit, 5242880);

    await db.close();
  });

  test("Delete empty bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "delete-me" }),
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/delete-me`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 200);

    // Verify deleted
    const getRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/delete-me`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(getRes.status, 404);

    await db.close();
  });

  test("Cannot delete non-empty bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "has-files" }),
    });

    // Upload a file
    await localFetch(`${SUPABASE_URL}/storage/v1/object/has-files/test.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "hello",
    });

    // Try to delete - should fail
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/has-files`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 409);
    const data = await res.json();
    assertExists(data.message);

    await db.close();
  });

  test("Empty bucket removes all objects", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "to-empty" }),
    });

    // Upload files
    for (const name of ["a.txt", "b.txt"]) {
      await localFetch(`${SUPABASE_URL}/storage/v1/object/to-empty/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: `content of ${name}`,
      });
    }

    // Empty bucket
    const emptyRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/to-empty/empty`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(emptyRes.status, 200);

    // Now delete should work
    const deleteRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/bucket/to-empty`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(deleteRes.status, 200);

    await db.close();
  });

  test("Duplicate bucket returns error", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "unique-name" }),
    });

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "unique-name" }),
    });

    assertEquals(res.status, 409);

    await db.close();
  });
});

// ============================================================================
// Object Upload & Download
// ============================================================================

describe("Storage Objects", () => {
  test("Upload and download file", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "files" }),
    });

    // Upload
    const uploadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/files/hello.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "Hello, world!",
      },
    );

    assertEquals(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assertExists(uploadData.Key);
    assertEquals(uploadData.Key, "files/hello.txt");

    // Download
    const downloadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/files/hello.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(downloadRes.status, 200);
    assertEquals(downloadRes.headers.get("Content-Type"), "text/plain");
    const text = await downloadRes.text();
    assertEquals(text, "Hello, world!");

    await db.close();
  });

  test("Upload binary file", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "binaries" }),
    });

    const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);

    const uploadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/binaries/data.bin`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: binaryData,
      },
    );

    assertEquals(uploadRes.status, 200);

    // Download and verify
    const downloadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/binaries/data.bin`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(downloadRes.status, 200);
    const downloaded = new Uint8Array(await downloadRes.arrayBuffer());
    assertEquals(downloaded, binaryData);

    await db.close();
  });

  test("Upload to nonexistent bucket fails", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/no-bucket/file.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "test",
      },
    );

    assertEquals(res.status, 500);

    await db.close();
  });

  test("Download nonexistent file returns 404", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "empty-bucket" }),
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/empty-bucket/nope.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 404);

    await db.close();
  });

  test("Duplicate upload without upsert fails", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "nodup" }),
    });

    // First upload
    await localFetch(`${SUPABASE_URL}/storage/v1/object/nodup/file.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "first",
    });

    // Second upload same path - should fail
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/nodup/file.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "second",
      },
    );

    assertEquals(res.status, 409);

    await db.close();
  });

  test("Upsert via x-upsert header", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "upsert-test" }),
    });

    // First upload
    await localFetch(
      `${SUPABASE_URL}/storage/v1/object/upsert-test/file.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "original",
      },
    );

    // Upsert with x-upsert header
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/upsert-test/file.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "x-upsert": "true",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "updated",
      },
    );

    assertEquals(res.status, 200);

    // Verify content was updated
    const downloadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/upsert-test/file.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    const text = await downloadRes.text();
    assertEquals(text, "updated");

    await db.close();
  });

  test("Update via PUT (upsert)", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "put-test" }),
    });

    // First upload via POST
    await localFetch(`${SUPABASE_URL}/storage/v1/object/put-test/file.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "v1",
    });

    // Update via PUT
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/put-test/file.txt`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "v2",
      },
    );

    assertEquals(res.status, 200);

    // Verify
    const downloadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/put-test/file.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(await downloadRes.text(), "v2");

    await db.close();
  });
});

// ============================================================================
// Object Exists (HEAD)
// ============================================================================

describe("Object Exists (HEAD)", () => {
  test("HEAD returns 200 for existing file", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "head-test" }),
    });

    await localFetch(`${SUPABASE_URL}/storage/v1/object/head-test/exists.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "I exist",
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/head-test/exists.txt`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 200);

    await db.close();
  });

  test("HEAD returns 404 for nonexistent file", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "head-test-2" }),
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/head-test-2/nope.txt`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 404);

    await db.close();
  });
});

// ============================================================================
// Object List
// ============================================================================

describe("Object List", () => {
  test("List objects in bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "list-test" }),
    });

    for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) {
      await localFetch(`${SUPABASE_URL}/storage/v1/object/list-test/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: `content of ${name}`,
      });
    }

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/list/list-test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ prefix: "", limit: 100, offset: 0 }),
      },
    );

    assertEquals(res.status, 200);
    const items = await res.json();
    assertEquals(items.length, 3);

    await db.close();
  });

  test("List with prefix filter", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "prefix-test" }),
    });

    // Upload files in different "folders"
    for (const path of ["docs/readme.md", "docs/guide.md", "images/logo.png"]) {
      await localFetch(
        `${SUPABASE_URL}/storage/v1/object/prefix-test/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Bearer ${auth.access_token}`,
          },
          body: "data",
        },
      );
    }

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/list/prefix-test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ prefix: "docs/" }),
      },
    );

    assertEquals(res.status, 200);
    const items = await res.json();
    assertEquals(items.length, 2);

    await db.close();
  });

  test("List with pagination", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "page-test" }),
    });

    for (let i = 0; i < 5; i++) {
      await localFetch(
        `${SUPABASE_URL}/storage/v1/object/page-test/file${i}.txt`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            Authorization: `Bearer ${auth.access_token}`,
          },
          body: `file ${i}`,
        },
      );
    }

    // Page 1: limit 2
    const res1 = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/list/page-test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ limit: 2, offset: 0 }),
      },
    );
    const page1 = await res1.json();
    assertEquals(page1.length, 2);

    // Page 2: offset 2, limit 2
    const res2 = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/list/page-test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ limit: 2, offset: 2 }),
      },
    );
    const page2 = await res2.json();
    assertEquals(page2.length, 2);

    // Page 3: offset 4
    const res3 = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/list/page-test`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ limit: 2, offset: 4 }),
      },
    );
    const page3 = await res3.json();
    assertEquals(page3.length, 1);

    await db.close();
  });
});

// ============================================================================
// Object Remove
// ============================================================================

describe("Object Remove", () => {
  test("Remove objects (batch delete)", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "remove-test" }),
    });

    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await localFetch(
        `${SUPABASE_URL}/storage/v1/object/remove-test/${name}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            Authorization: `Bearer ${auth.access_token}`,
          },
          body: "x",
        },
      );
    }

    // Remove a.txt and b.txt
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/remove-test`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ prefixes: ["a.txt", "b.txt"] }),
      },
    );

    assertEquals(res.status, 200);
    const removed = await res.json();
    assertEquals(removed.length, 2);

    // c.txt should still exist
    const headRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/remove-test/c.txt`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(headRes.status, 200);

    await db.close();
  });
});

// ============================================================================
// Object Move & Copy
// ============================================================================

describe("Object Move & Copy", () => {
  test("Move object to new path", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "move-test" }),
    });

    await localFetch(`${SUPABASE_URL}/storage/v1/object/move-test/old.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "moveable content",
    });

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/object/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({
        bucketId: "move-test",
        sourceKey: "old.txt",
        destinationKey: "new.txt",
      }),
    });

    assertEquals(res.status, 200);

    // Old path should be gone
    const oldRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/move-test/old.txt`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(oldRes.status, 404);

    // New path should have the content
    const newRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/move-test/new.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );
    assertEquals(newRes.status, 200);
    assertEquals(await newRes.text(), "moveable content");

    await db.close();
  });

  test("Copy object", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "copy-test" }),
    });

    await localFetch(
      `${SUPABASE_URL}/storage/v1/object/copy-test/original.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "copy me",
      },
    );

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({
        bucketId: "copy-test",
        sourceKey: "original.txt",
        destinationKey: "duplicate.txt",
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();
    assertExists(data.Key);

    // Both files should exist
    for (const name of ["original.txt", "duplicate.txt"]) {
      const headRes = await localFetch(
        `${SUPABASE_URL}/storage/v1/object/copy-test/${name}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.access_token}` },
        },
      );
      assertEquals(headRes.status, 200);
      assertEquals(await headRes.text(), "copy me");
    }

    await db.close();
  });
});

// ============================================================================
// Object Info
// ============================================================================

describe("Object Info", () => {
  test("Get object info", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "info-test" }),
    });

    await localFetch(`${SUPABASE_URL}/storage/v1/object/info-test/doc.txt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: "info content",
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/info/info-test/doc.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 200);
    const info = await res.json();
    assertExists(info.id);
    assertEquals(info.name, "doc.txt");
    assertEquals(info.bucketId, "info-test");
    assertExists(info.createdAt);
    assertExists(info.metadata);

    await db.close();
  });
});

// ============================================================================
// Signed URLs
// ============================================================================

describe("Storage Signed URLs", () => {
  test("Create and download via signed URL", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "signed-test" }),
    });

    await localFetch(
      `${SUPABASE_URL}/storage/v1/object/signed-test/secret.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "secret content",
      },
    );

    // Create signed URL
    const signRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/sign/signed-test/secret.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      },
    );

    assertEquals(signRes.status, 200);
    const signData = await signRes.json();
    assertExists(signData.signedURL);

    // Download via signed URL (no auth header needed)
    const downloadRes = await localFetch(
      `${SUPABASE_URL}/storage/v1${signData.signedURL}`,
      {
        method: "GET",
      },
    );

    assertEquals(downloadRes.status, 200);
    assertEquals(await downloadRes.text(), "secret content");

    await db.close();
  });

  test("Batch create signed URLs", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "batch-sign" }),
    });

    for (const name of ["a.txt", "b.txt"]) {
      await localFetch(
        `${SUPABASE_URL}/storage/v1/object/batch-sign/${name}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            Authorization: `Bearer ${auth.access_token}`,
          },
          body: name,
        },
      );
    }

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/sign/batch-sign`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: JSON.stringify({
          expiresIn: 3600,
          paths: ["a.txt", "b.txt"],
        }),
      },
    );

    assertEquals(res.status, 200);
    const results = await res.json();
    assertEquals(results.length, 2);
    assertExists(results[0].signedURL);
    assertExists(results[1].signedURL);
    assertEquals(results[0].error, null);
    assertEquals(results[1].error, null);

    await db.close();
  });
});

// ============================================================================
// Public Downloads
// ============================================================================

describe("Storage Public", () => {
  test("Download from public bucket", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "public-bucket", public: true }),
    });

    await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public-bucket/readme.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "public file",
      },
    );

    // Download without auth via public endpoint
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/public-bucket/readme.txt`,
      { method: "GET" },
    );

    assertEquals(res.status, 200);
    assertEquals(await res.text(), "public file");

    await db.close();
  });

  test("Private bucket rejects public download", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "private-bucket", public: false }),
    });

    await localFetch(
      `${SUPABASE_URL}/storage/v1/object/private-bucket/secret.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "private file",
      },
    );

    // Try public download - should be rejected
    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/private-bucket/secret.txt`,
      { method: "GET" },
    );

    assertEquals(res.status, 400);

    await db.close();
  });
});

// ============================================================================
// Bucket Constraints
// ============================================================================

describe("Storage Constraints", () => {
  test("File size limit enforced", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    // Create bucket with 10 byte limit
    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "tiny-bucket", file_size_limit: 10 }),
    });

    // Upload small file - should succeed
    const small = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/tiny-bucket/small.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "hi",
      },
    );
    assertEquals(small.status, 200);

    // Upload large file - should fail
    const large = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/tiny-bucket/large.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "this string is definitely longer than ten bytes",
      },
    );
    assertEquals(large.status, 422);

    await db.close();
  });

  test("MIME type restriction enforced", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    // Create bucket that only allows images
    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({
        name: "images-only",
        allowed_mime_types: ["image/*"],
      }),
    });

    // Upload image - should succeed
    const imgRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/images-only/photo.png`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: new Uint8Array([137, 80, 78, 71]), // PNG header bytes
      },
    );
    assertEquals(imgRes.status, 200);

    // Upload text - should fail
    const txtRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/images-only/readme.txt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${auth.access_token}`,
        },
        body: "not an image",
      },
    );
    assertEquals(txtRes.status, 422);

    await db.close();
  });
});

// ============================================================================
// Nested Path Support
// ============================================================================

describe("Nested Path Support", () => {
  test("Upload and download with nested paths", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ name: "nested" }),
    });

    const path = "deeply/nested/folder/file.json";
    await localFetch(`${SUPABASE_URL}/storage/v1/object/nested/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ key: "value" }),
    });

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/nested/${path}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.key, "value");

    await db.close();
  });
});

// ============================================================================
// Storage disabled via config
// ============================================================================

describe("Storage Config", () => {
  test("storageBackend: false disables storage interception", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });

    let passthroughCalled = false;
    const mockFetch = async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      passthroughCalled = true;
      return new Response(JSON.stringify({ mock: true }), { status: 200 });
    };

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
      storageBackend: false,
      originalFetch: mockFetch,
    });

    const res = await localFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "GET",
    });

    assertEquals(passthroughCalled, true);
    assertEquals(res.status, 200);

    await db.close();
  });
});

// ============================================================================
// 404 for unknown storage endpoints
// ============================================================================

describe("Storage Routes", () => {
  test("Unknown endpoint returns 404", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });
    const auth = await signUp(localFetch);

    const res = await localFetch(
      `${SUPABASE_URL}/storage/v1/unknown/endpoint`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.access_token}` },
      },
    );

    assertEquals(res.status, 404);

    await db.close();
  });
});
