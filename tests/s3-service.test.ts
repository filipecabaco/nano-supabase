import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";
import {
	LocalstackContainer,
	type StartedLocalStackContainer,
} from "@testcontainers/localstack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../dist/cli.js");

const ADMIN_TOKEN = "test-s3-admin-token";
const REGION = "us-east-1";
const S3_BUCKET = "test-service-bucket";
const CREDENTIALS = { accessKeyId: "test", secretAccessKey: "test" };

let localstack: StartedLocalStackContainer;
let s3Endpoint: string;

async function waitForHealth(url: string, timeout = 45_000): Promise<void> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/health`);
			if (res.ok) return;
		} catch {
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	throw new Error(
		`Service at ${url} did not become healthy within ${timeout}ms`,
	);
}

async function createS3Bucket(
	endpoint: string,
	bucket: string,
): Promise<void> {
	const aws = new AwsClient({ ...CREDENTIALS, region: REGION, service: "s3" });
	const resp = await aws.fetch(`${endpoint}/${bucket}`, { method: "PUT" });
	if (!resp.ok && resp.status !== 409) {
		throw new Error(`Failed to create bucket: ${resp.status}`);
	}
}

async function s3ObjectExists(
	endpoint: string,
	bucket: string,
	key: string,
): Promise<boolean> {
	const aws = new AwsClient({ ...CREDENTIALS, region: REGION, service: "s3" });
	const resp = await aws.fetch(`${endpoint}/${bucket}/${key}`, {
		method: "HEAD",
	});
	return resp.ok;
}

beforeAll(async () => {
	localstack = await new LocalstackContainer(
		"localstack/localstack:4",
	).start();
	s3Endpoint = localstack.getConnectionUri();
	await createS3Bucket(s3Endpoint, S3_BUCKET);
}, 120_000);

afterAll(async () => {
	await localstack?.stop();
});

describe("service mode with S3 offload", () => {
	let svcProcess: ChildProcess;
	let dataDir: string;
	const port = 54530;
	const tcpPort = 54531;
	const base = `http://localhost:${port}`;
	let tenantToken: string;
	let tenantId: string;

	function startService(extraArgs: string[] = []): ChildProcess {
		return spawn(
			"node",
			[
				CLI,
				"service",
				`--service-port=${port}`,
				`--tcp-port=${tcpPort}`,
				`--admin-token=${ADMIN_TOKEN}`,
				`--data-dir=${dataDir}`,
				`--secret=test-s3-secret`,
				`--s3-bucket=${S3_BUCKET}`,
				`--s3-endpoint=${s3Endpoint}`,
				...extraArgs,
			],
			{
				stdio: "ignore",
				detached: false,
				env: {
					...process.env,
					AWS_ACCESS_KEY_ID: CREDENTIALS.accessKeyId,
					AWS_SECRET_ACCESS_KEY: CREDENTIALS.secretAccessKey,
					AWS_REGION: REGION,
				},
			},
		);
	}

	beforeAll(async () => {
		dataDir = mkdtempSync(join(tmpdir(), "nano-s3-svc-data-"));
		svcProcess = startService();
		await waitForHealth(base);
	}, 60_000);

	afterAll(async () => {
		svcProcess?.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 500));
		rmSync(dataDir, { recursive: true, force: true });
	});

	test("create tenant and insert data", async () => {
		const createRes = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ADMIN_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ slug: "s3-tenant" }),
		});
		expect(createRes.status).toBe(201);
		const body = await createRes.json();
		tenantToken = body.token;
		expect(tenantToken).toBeTruthy();

		const infoRes = await fetch(`${base}/admin/tenants/s3-tenant`, {
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		const info = await infoRes.json();
		tenantId = info.id;

		const signupRes = await fetch(`${base}/s3-tenant/auth/v1/signup`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${tenantToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email: "s3test@example.com",
				password: "password123",
			}),
		});
		expect(signupRes.status).toBe(200);
	});

	test("pause offloads tenant data to S3", async () => {
		const pauseRes = await fetch(`${base}/admin/tenants/s3-tenant/pause`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(pauseRes.status).toBe(200);
		const body = await pauseRes.json();
		expect(body.state).toBe("sleeping");

		const archiveExists = await s3ObjectExists(
			s3Endpoint,
			S3_BUCKET,
			`tenants/${tenantId}/data.tar.gz`,
		);
		expect(archiveExists).toBe(true);
	});

	test("wake restores tenant from S3 with data intact", async () => {
		const wakeRes = await fetch(`${base}/admin/tenants/s3-tenant/wake`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(wakeRes.status).toBe(200);
		expect((await wakeRes.json()).state).toBe("running");

		const signIn = await fetch(
			`${base}/s3-tenant/auth/v1/token?grant_type=password`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${tenantToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: "s3test@example.com",
					password: "password123",
				}),
			},
		);
		expect(signIn.status).toBe(200);
		const signInBody = await signIn.json();
		expect(signInBody.access_token).toBeTruthy();
	}, 30_000);

	test("storage blobs persist in S3 backend", async () => {
		const createBucketRes = await fetch(
			`${base}/s3-tenant/storage/v1/bucket`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${tenantToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "uploads", public: true }),
			},
		);
		expect(createBucketRes.status).toBe(200);

		const fileContent = new TextEncoder().encode("s3 stored file");
		const uploadRes = await fetch(
			`${base}/s3-tenant/storage/v1/object/uploads/doc.txt`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${tenantToken}`,
					"Content-Type": "text/plain",
				},
				body: fileContent,
			},
		);
		expect(uploadRes.status).toBe(200);

		const downloadRes = await fetch(
			`${base}/s3-tenant/storage/v1/object/public/uploads/doc.txt`,
			{
				headers: { Authorization: `Bearer ${tenantToken}` },
			},
		);
		expect(downloadRes.status).toBe(200);
		const text = await downloadRes.text();
		expect(text).toBe("s3 stored file");

		const blobExists = await s3ObjectExists(
			s3Endpoint,
			S3_BUCKET,
			`tenants/${tenantId}/storage/uploads/doc.txt`,
		);
		expect(blobExists).toBe(true);
	});
});
