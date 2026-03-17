/**
 * Storage Tests
 *
 * Tests storage operations through supabase-js: bucket CRUD, file upload/download/list/delete,
 * public buckets, signed URLs, move/copy, and per-user RLS enforcement.
 */

import { createClient } from "@supabase/supabase-js";
import {
  test,
  describe,
  assertEquals,
  assertExists,
} from "./compat.ts";
import { createFetchAdapter } from "../src/client.ts";
import { createPGlite } from "../src/pglite-factory.ts";

const SUPABASE_URL = "http://localhost:54321";

describe("Storage", () => {
  test("Upload, list, download, delete via supabase-js", async () => {
    const db = createPGlite();
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
      .list("notes");

    assertEquals(listError, null);
    assertExists(listData);
    assertEquals(listData!.length, 1);
    assertEquals(listData![0]!.name, "hello.txt");

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

  test("Folder navigation — list shows virtual folders and files at correct depth", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "folder-nav@example.com", password: "pass1234" });
    await supabase.storage.createBucket("nav-bucket", { public: false });

    const enc = (s: string) => new TextEncoder().encode(s);
    await supabase.storage.from("nav-bucket").upload("a/b/deep.txt", enc("deep"), { contentType: "text/plain" });
    await supabase.storage.from("nav-bucket").upload("a/shallow.txt", enc("shallow"), { contentType: "text/plain" });
    await supabase.storage.from("nav-bucket").upload("root.txt", enc("root"), { contentType: "text/plain" });

    // Root listing: should show folder "a" and file "root.txt"
    const { data: root } = await supabase.storage.from("nav-bucket").list("");
    assertExists(root);
    const rootNames = root!.map((o) => o.name).sort();
    assertEquals(rootNames, ["a", "root.txt"]);

    // One level deep: list "a" — should show folder "b" and file "shallow.txt"
    const { data: inA } = await supabase.storage.from("nav-bucket").list("a");
    assertExists(inA);
    const inANames = inA!.map((o) => o.name).sort();
    assertEquals(inANames, ["b", "shallow.txt"]);

    // Two levels deep: list "a/b" — should show file "deep.txt"
    const { data: inAB } = await supabase.storage.from("nav-bucket").list("a/b");
    assertExists(inAB);
    assertEquals(inAB!.length, 1);
    assertEquals(inAB![0]!.name, "deep.txt");

    await db.close();
  });

  test("Upload to nested folder and download back", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });
    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "nested@example.com", password: "pass1234" });
    await supabase.storage.createBucket("nested-bucket", { public: false });

    const enc = (s: string) => new TextEncoder().encode(s);

    const { error: e1 } = await supabase.storage.from("nested-bucket").upload("a/b/c/deep.txt", enc("deep content"), { contentType: "text/plain" });
    assertEquals(e1, null);

    const { error: e2 } = await supabase.storage.from("nested-bucket").upload("a/b/mid.txt", enc("mid content"), { contentType: "text/plain" });
    assertEquals(e2, null);

    const { error: e3 } = await supabase.storage.from("nested-bucket").upload("a/top.txt", enc("top content"), { contentType: "text/plain" });
    assertEquals(e3, null);

    const { data: deepFile, error: de } = await supabase.storage.from("nested-bucket").download("a/b/c/deep.txt");
    assertEquals(de, null);
    assertExists(deepFile);
    assertEquals(await deepFile!.text(), "deep content");

    const { data: midFile } = await supabase.storage.from("nested-bucket").download("a/b/mid.txt");
    assertExists(midFile);
    assertEquals(await midFile!.text(), "mid content");

    const { data: topFile } = await supabase.storage.from("nested-bucket").download("a/top.txt");
    assertExists(topFile);
    assertEquals(await topFile!.text(), "top content");

    await db.close();
  });

  test("Move file between folders", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });
    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "mover2@example.com", password: "pass1234" });
    await supabase.storage.createBucket("move-bucket", { public: false });

    const enc = (s: string) => new TextEncoder().encode(s);
    await supabase.storage.from("move-bucket").upload("folder-a/file.txt", enc("hello"), { contentType: "text/plain" });

    const { error: moveErr } = await supabase.storage.from("move-bucket").move("folder-a/file.txt", "folder-b/file.txt");
    assertEquals(moveErr, null);

    const { data: atOld } = await supabase.storage.from("move-bucket").list("folder-a");
    assertEquals(atOld?.length ?? 0, 0);

    const { data: atNew } = await supabase.storage.from("move-bucket").list("folder-b");
    assertExists(atNew);
    assertEquals(atNew!.length, 1);
    assertEquals(atNew![0]!.name, "file.txt");

    await db.close();
  });

  test("Remove all files in a subfolder", async () => {
    const db = createPGlite();
    const { localFetch } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });
    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "remover@example.com", password: "pass1234" });
    await supabase.storage.createBucket("rm-bucket", { public: false });

    const enc = (s: string) => new TextEncoder().encode(s);
    await supabase.storage.from("rm-bucket").upload("docs/a.txt", enc("a"), { contentType: "text/plain" });
    await supabase.storage.from("rm-bucket").upload("docs/b.txt", enc("b"), { contentType: "text/plain" });
    await supabase.storage.from("rm-bucket").upload("keep/c.txt", enc("c"), { contentType: "text/plain" });

    const { error: rmErr } = await supabase.storage.from("rm-bucket").remove(["docs/a.txt", "docs/b.txt"]);
    assertEquals(rmErr, null);

    const { data: afterDocs } = await supabase.storage.from("rm-bucket").list("docs");
    assertEquals(afterDocs?.length ?? 0, 0);

    const { data: afterKeep } = await supabase.storage.from("rm-bucket").list("keep");
    assertExists(afterKeep);
    assertEquals(afterKeep!.length, 1);

    await db.close();
  });

  test("Public bucket allows unauthenticated download", async () => {
    const db = createPGlite();
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
    const db = createPGlite();
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
    const db = createPGlite();
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
    const db = createPGlite();
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

  test("getObjectInfo returns metadata for existing object and null for missing path", async () => {
    const db = createPGlite();
    const { localFetch, storageHandler } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });
    assertExists(storageHandler);

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "infouser@example.com", password: "pass1234" });
    await supabase.storage.createBucket("info-bucket", { public: false });
    await supabase.storage.from("info-bucket").upload(
      "docs/readme.txt",
      new TextEncoder().encode("hello"),
      { contentType: "text/plain" },
    );

    const info = await storageHandler!.getObjectInfo("info-bucket", "docs/readme.txt");
    assertExists(info);
    assertEquals(info!.bucket_id, "info-bucket");
    assertEquals(info!.name, "docs/readme.txt");

    const missing = await storageHandler!.getObjectInfo("info-bucket", "does/not/exist.txt");
    assertEquals(missing, null);

    await db.close();
  });

  test("verifySignedUrl returns bucket and path for valid token and null for invalid/expired token", async () => {
    const db = createPGlite();
    const { localFetch, storageHandler } = await createFetchAdapter({ db, supabaseUrl: SUPABASE_URL });
    assertExists(storageHandler);

    const supabase = createClient(SUPABASE_URL, "local-anon-key", {
      auth: { autoRefreshToken: false },
      global: { fetch: localFetch },
    });

    await supabase.auth.signUp({ email: "signer@example.com", password: "pass1234" });
    await supabase.storage.createBucket("signed-bucket", { public: false });
    await supabase.storage.from("signed-bucket").upload(
      "file.txt",
      new TextEncoder().encode("content"),
      { contentType: "text/plain" },
    );

    const token = await storageHandler!.createSignedUrl("signed-bucket", "file.txt", 3600);
    assertExists(token);

    const payload = await storageHandler!.verifySignedUrl(token);
    assertExists(payload);
    assertEquals(payload!.bucket_id, "signed-bucket");
    assertEquals(payload!.object_name, "file.txt");

    const nullResult = await storageHandler!.verifySignedUrl("invalid.token");
    assertEquals(nullResult, null);

    await db.close();
  });

  test("Move and copy through supabase-js", async () => {
    const db = createPGlite();
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
