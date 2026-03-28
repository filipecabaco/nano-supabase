import { createClient } from "@supabase/supabase-js";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { AwsClient } from "aws4fetch";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFetchAdapter } from "../src/client.ts";
import { createPGlite } from "../src/pglite-factory.ts";
import { S3StorageBackend } from "../src/storage/s3-backend.ts";

const SUPABASE_URL = "http://localhost:54321";
const BUCKET = "test-storage-bucket";
const REGION = "us-east-1";
const CREDENTIALS = { accessKeyId: "test", secretAccessKey: "test" };

let container: StartedLocalStackContainer;
let endpoint: string;

async function createBucket(name: string): Promise<void> {
	const aws = new AwsClient({ ...CREDENTIALS, region: REGION, service: "s3" });
	const resp = await aws.fetch(`${endpoint}/${name}`, { method: "PUT" });
	if (!resp.ok && resp.status !== 409) {
		throw new Error(`Failed to create bucket: ${resp.status}`);
	}
}

beforeAll(async () => {
	container = await new LocalstackContainer("localstack/localstack:4").start();
	endpoint = container.getConnectionUri();
	await createBucket(BUCKET);
}, 120_000);

afterAll(async () => {
	await container?.stop();
});

describe("S3StorageBackend", () => {
	function createBackend(prefix?: string): S3StorageBackend {
		return new S3StorageBackend({
			bucket: BUCKET,
			endpoint,
			region: REGION,
			credentials: CREDENTIALS,
			prefix: prefix ?? `test-${Date.now()}/`,
		});
	}

	test("put, get, exists, delete", async () => {
		const backend = createBackend();

		const data = new TextEncoder().encode("hello s3");
		const metadata = { contentType: "text/plain", size: data.byteLength };

		await backend.put("bucket1/file.txt", data, metadata);

		expect(await backend.exists("bucket1/file.txt")).toBe(true);
		expect(await backend.exists("bucket1/missing.txt")).toBe(false);

		const result = await backend.get("bucket1/file.txt");
		expect(result).not.toBeNull();
		expect(new TextDecoder().decode(result?.data)).toBe("hello s3");
		expect(result?.metadata.contentType).toBe("text/plain");
		expect(result?.metadata.size).toBe(data.byteLength);

		expect(await backend.get("bucket1/missing.txt")).toBeNull();

		expect(await backend.delete("bucket1/file.txt")).toBe(true);
		expect(await backend.delete("bucket1/file.txt")).toBe(false);
		expect(await backend.exists("bucket1/file.txt")).toBe(false);
	});

	test("copy", async () => {
		const backend = createBackend();

		const data = new TextEncoder().encode("copy me to s3");
		await backend.put("b/src.txt", data, {
			contentType: "text/plain",
			size: data.byteLength,
		});

		expect(await backend.copy("b/src.txt", "b/dst.txt")).toBe(true);
		expect(await backend.copy("b/nope.txt", "b/dst2.txt")).toBe(false);

		const copied = await backend.get("b/dst.txt");
		expect(copied).not.toBeNull();
		expect(new TextDecoder().decode(copied?.data)).toBe("copy me to s3");
	});

	test("deleteByPrefix", async () => {
		const backend = createBackend();

		const data = new TextEncoder().encode("x");
		const meta = { contentType: "text/plain", size: 1 };
		await backend.put("bucket/a.txt", data, meta);
		await backend.put("bucket/b.txt", data, meta);
		await backend.put("other/c.txt", data, meta);

		const count = await backend.deleteByPrefix("bucket/");
		expect(count).toBe(2);
		expect(await backend.exists("bucket/a.txt")).toBe(false);
		expect(await backend.exists("bucket/b.txt")).toBe(false);
		expect(await backend.exists("other/c.txt")).toBe(true);
	});

	test("end-to-end with supabase-js", async () => {
		const db = createPGlite();
		const backend = createBackend();
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
			email: "s3user@example.com",
			password: "securepass123",
		});
		expect(signUpError).toBeNull();

		const { error: bucketError } = await supabase.storage.createBucket(
			"s3-files",
			{ public: false },
		);
		expect(bucketError).toBeNull();

		const content = new TextEncoder().encode("data in s3");
		const { error: uploadError } = await supabase.storage
			.from("s3-files")
			.upload("test.txt", content, { contentType: "text/plain" });
		expect(uploadError).toBeNull();

		const { data: downloadData, error: downloadError } = await supabase.storage
			.from("s3-files")
			.download("test.txt");
		expect(downloadError).toBeNull();
		expect(downloadData).not.toBeNull();
		const text = await downloadData?.text();
		expect(text).toBe("data in s3");

		expect(await backend.exists("s3-files/test.txt")).toBe(true);

		await db.close();
	});
});
