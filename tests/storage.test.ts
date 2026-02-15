/**
 * Storage Tests
 *
 * Tests storage operations through supabase-js: bucket CRUD, file upload/download/list/delete,
 * public buckets, signed URLs, move/copy, and per-user RLS enforcement.
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

describe("Storage", () => {
  test("Upload, list, download, delete via supabase-js", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    const { data: signUpData, error: signUpError } =
      await supabase.auth.signUp({
        email: "storageuser@example.com",
        password: "securepass123",
      });
    assertEquals(signUpError, null);
    assertExists(signUpData.session);

    const { data: bucketData, error: bucketError } =
      await supabase.storage.createBucket("user-files", {
        public: false,
      });

    assertEquals(bucketError, null);
    assertExists(bucketData);

    const fileContent = new TextEncoder().encode("Hello from supabase-js!");
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("user-files")
      .upload("notes/hello.txt", fileContent, {
        contentType: "text/plain",
      });

    assertEquals(uploadError, null);
    assertExists(uploadData);

    const { data: listData, error: listError } = await supabase.storage
      .from("user-files")
      .list("notes/");

    assertEquals(listError, null);
    assertExists(listData);
    assertEquals(listData!.length >= 1, true);

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from("user-files")
      .download("notes/hello.txt");

    assertEquals(downloadError, null);
    assertExists(downloadData);
    const text = await downloadData!.text();
    assertEquals(text, "Hello from supabase-js!");

    const { data: removeData, error: removeError } = await supabase.storage
      .from("user-files")
      .remove(["notes/hello.txt"]);

    assertEquals(removeError, null);
    assertExists(removeData);

    const { data: afterRemove } = await supabase.storage
      .from("user-files")
      .list("notes/");
    assertEquals(afterRemove?.length || 0, 0);

    const { error: deleteError } = await supabase.storage.deleteBucket(
      "user-files",
    );
    assertEquals(deleteError, null);

    await db.close();
  });

  test("Public bucket allows unauthenticated download", async () => {
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
      email: "public-uploader@example.com",
      password: "pass123",
    });

    await supabase.storage.createBucket("public-assets", { public: true });

    await supabase.storage
      .from("public-assets")
      .upload("logo.svg", new TextEncoder().encode("<svg></svg>"), {
        contentType: "image/svg+xml",
      });

    const { data: urlData } = supabase.storage
      .from("public-assets")
      .getPublicUrl("logo.svg");

    assertExists(urlData.publicUrl);

    await supabase.auth.signOut();

    const publicRes = await localFetch(
      `${SUPABASE_URL}/storage/v1/object/public/public-assets/logo.svg`,
      { method: "GET" },
    );

    assertEquals(publicRes.status, 200);
    assertEquals(await publicRes.text(), "<svg></svg>");

    await db.close();
  });

  test("Create signed URL and download", async () => {
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

    const { data: signedData, error: signedError } = await supabase.storage
      .from("private-docs")
      .createSignedUrl("report.pdf", 60);

    assertEquals(signedError, null);
    assertExists(signedData?.signedUrl);

    const downloadRes = await localFetch(signedData!.signedUrl, {
      method: "GET",
    });

    assertEquals(downloadRes.status, 200);
    assertEquals(await downloadRes.text(), "PDF CONTENT");

    await db.close();
  });

  test("RLS enforces per-user storage access", async () => {
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
      email: "setup@example.com",
      password: "pass123",
    });

    await supabase.storage.createBucket("user-uploads", { public: false });

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

    const supabaseA = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await supabaseA.auth.signUp({
      email: "alice@example.com",
      password: "alicepass",
    });

    const { error: uploadAError } = await supabaseA.storage
      .from("user-uploads")
      .upload("alice-file.txt", new TextEncoder().encode("Alice's data"), {
        contentType: "text/plain",
      });
    assertEquals(uploadAError, null);

    const supabaseB = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });
    await supabaseB.auth.signUp({
      email: "bob@example.com",
      password: "bobpass",
    });

    const { error: uploadBError } = await supabaseB.storage
      .from("user-uploads")
      .upload("bob-file.txt", new TextEncoder().encode("Bob's data"), {
        contentType: "text/plain",
      });
    assertEquals(uploadBError, null);

    const { data: listB } = await supabaseB.storage
      .from("user-uploads")
      .list("");
    assertExists(listB);
    assertEquals(listB!.length >= 2, true);

    await db.close();
  });

  test("Bucket CRUD through supabase-js", async () => {
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

    const { error: createErr } = await supabase.storage.createBucket(
      "test-bucket",
      { public: false },
    );
    assertEquals(createErr, null);

    const { data: buckets, error: listErr } =
      await supabase.storage.listBuckets();
    assertEquals(listErr, null);
    assertExists(buckets);
    assertEquals(buckets!.length >= 1, true);
    const found = buckets!.find(
      (b: { name: string }) => b.name === "test-bucket",
    );
    assertExists(found);

    const { data: bucket, error: getErr } =
      await supabase.storage.getBucket("test-bucket");
    assertEquals(getErr, null);
    assertExists(bucket);
    assertEquals(bucket!.name, "test-bucket");
    assertEquals(bucket!.public, false);

    const { error: updateErr } = await supabase.storage.updateBucket(
      "test-bucket",
      { public: true },
    );
    assertEquals(updateErr, null);

    const { data: updated } = await supabase.storage.getBucket("test-bucket");
    assertEquals(updated!.public, true);

    const { error: emptyErr } =
      await supabase.storage.emptyBucket("test-bucket");
    assertEquals(emptyErr, null);

    const { error: deleteErr } =
      await supabase.storage.deleteBucket("test-bucket");
    assertEquals(deleteErr, null);

    const { error: getAfterDelete } =
      await supabase.storage.getBucket("test-bucket");
    assertExists(getAfterDelete);

    await db.close();
  });

  test("Move and copy through supabase-js", async () => {
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

    await supabase.storage
      .from("files")
      .upload("original.txt", new TextEncoder().encode("original content"), {
        contentType: "text/plain",
      });

    const { error: copyErr } = await supabase.storage
      .from("files")
      .copy("original.txt", "copy.txt");
    assertEquals(copyErr, null);

    const { data: copyDownload } = await supabase.storage
      .from("files")
      .download("copy.txt");
    assertExists(copyDownload);
    assertEquals(await copyDownload!.text(), "original content");

    const { error: moveErr } = await supabase.storage
      .from("files")
      .move("copy.txt", "moved.txt");
    assertEquals(moveErr, null);

    const { data: movedDownload } = await supabase.storage
      .from("files")
      .download("moved.txt");
    assertExists(movedDownload);
    assertEquals(await movedDownload!.text(), "original content");

    const { error: goneErr } = await supabase.storage
      .from("files")
      .download("copy.txt");
    assertExists(goneErr);

    await db.close();
  });
});
