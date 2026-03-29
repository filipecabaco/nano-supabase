import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createFetchAdapter } from "../src/client.ts";
import { createPGlite } from "../src/pglite-factory.ts";
import { FileSystemStorageBackend } from "../src/storage/fs-backend.ts";
import { assertEquals, assertExists, describe, test } from "./compat.ts";

const SUPABASE_URL = "http://localhost:54321";

describe("FileSystemStorageBackend", () => {
  test("put, get, exists, delete", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "nano-fs-test-"));
    try {
      const backend = new FileSystemStorageBackend(baseDir);

      const data = new TextEncoder().encode("hello world");
      const metadata = { contentType: "text/plain", size: data.byteLength };

      await backend.put("bucket1/file.txt", data, metadata);

      assertEquals(await backend.exists("bucket1/file.txt"), true);
      assertEquals(await backend.exists("bucket1/missing.txt"), false);

      const result = await backend.get("bucket1/file.txt");
      assertExists(result);
      assertEquals(new TextDecoder().decode(result.data), "hello world");
      assertEquals(result.metadata.contentType, "text/plain");
      assertEquals(result.metadata.size, data.byteLength);

      assertEquals(await backend.get("bucket1/missing.txt"), null);

      assertEquals(await backend.delete("bucket1/file.txt"), true);
      assertEquals(await backend.delete("bucket1/file.txt"), false);
      assertEquals(await backend.exists("bucket1/file.txt"), false);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("copy", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "nano-fs-test-"));
    try {
      const backend = new FileSystemStorageBackend(baseDir);

      const data = new TextEncoder().encode("copy me");
      await backend.put("b/src.txt", data, {
        contentType: "text/plain",
        size: data.byteLength,
      });

      assertEquals(await backend.copy("b/src.txt", "b/dst.txt"), true);
      assertEquals(await backend.copy("b/nope.txt", "b/dst2.txt"), false);

      const copied = await backend.get("b/dst.txt");
      assertExists(copied);
      assertEquals(new TextDecoder().decode(copied.data), "copy me");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("deleteByPrefix", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "nano-fs-test-"));
    try {
      const backend = new FileSystemStorageBackend(baseDir);

      const data = new TextEncoder().encode("x");
      const meta = { contentType: "text/plain", size: 1 };
      await backend.put("bucket/a.txt", data, meta);
      await backend.put("bucket/b.txt", data, meta);
      await backend.put("other/c.txt", data, meta);

      const count = await backend.deleteByPrefix("bucket/");
      assertEquals(count, 2);
      assertEquals(await backend.exists("bucket/a.txt"), false);
      assertEquals(await backend.exists("bucket/b.txt"), false);
      assertEquals(await backend.exists("other/c.txt"), true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("end-to-end with supabase-js", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "nano-fs-e2e-"));
    try {
      const db = createPGlite();
      const backend = new FileSystemStorageBackend(join(baseDir, "storage"));
      const { localFetch } = await createFetchAdapter({
        db,
        supabaseUrl: SUPABASE_URL,
        storageBackend: backend,
      });

      const supabase = createClient(SUPABASE_URL, "local-anon-key", {
        auth: { autoRefreshToken: false },
        global: { fetch: localFetch },
      });

      const { error: signUpError } = await supabase.auth.signUp({
        email: "fsuser@example.com",
        password: "securepass123",
      });
      assertEquals(signUpError, null);

      const { error: bucketError } = await supabase.storage.createBucket(
        "files",
        { public: false },
      );
      assertEquals(bucketError, null);

      const content = new TextEncoder().encode("persistent data");
      const { error: uploadError } = await supabase.storage
        .from("files")
        .upload("test.txt", content, { contentType: "text/plain" });
      assertEquals(uploadError, null);

      const { data: downloadData, error: downloadError } =
        await supabase.storage.from("files").download("test.txt");
      assertEquals(downloadError, null);
      assertExists(downloadData);
      const text = await downloadData.text();
      assertEquals(text, "persistent data");

      assertEquals(await backend.exists("files/test.txt"), true);

      await db.close();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
