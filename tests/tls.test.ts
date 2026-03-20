import https from "node:https";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import selfsigned from "selfsigned";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
	PGlitePooler,
	PGliteTCPMuxServer,
	PGliteTCPServer,
} from "../src/index.ts";
import { assertEquals } from "./compat.ts";

let pems: { private: string; cert: string };

beforeAll(async () => {
	pems = await selfsigned.generate(
		[{ name: "commonName", value: "localhost" }],
		{ days: 1 },
	);
});


describe("PGliteTCPServer with TLS", () => {
	test("pg client connects with sslmode=require and queries succeed", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const server = new PGliteTCPServer(pooler, undefined, {
			cert: Buffer.from(pems.cert),
			key: Buffer.from(pems.private),
		});
		await server.start(0 as unknown as number, "127.0.0.1");
		const addr = (
			server as unknown as { server: import("node:net").Server }
		).server.address() as { port: number };
		const port = addr.port;

		const client = new pg.Client({
			host: "127.0.0.1",
			port,
			user: "postgres",
			database: "postgres",
			ssl: { ca: pems.cert, rejectUnauthorized: true },
		});
		try {
			await client.connect();
			const res = await client.query("SELECT 1 AS val");
			assertEquals(res.rows[0].val, 1);
		} finally {
			await client.end().catch(() => {});
			await server.stop();
			await pooler.stop();
		}
	});

	test("plain client (sslmode=disable) still connects when TLS is configured", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const server = new PGliteTCPServer(pooler, undefined, {
			cert: Buffer.from(pems.cert),
			key: Buffer.from(pems.private),
		});
		await server.start(0 as unknown as number, "127.0.0.1");
		const addr = (
			server as unknown as { server: import("node:net").Server }
		).server.address() as { port: number };
		const port = addr.port;

		const client = new pg.Client({
			host: "127.0.0.1",
			port,
			user: "postgres",
			database: "postgres",
			ssl: false,
		});
		try {
			await client.connect();
			const res = await client.query("SELECT 2 AS val");
			assertEquals(res.rows[0].val, 2);
		} finally {
			await client.end().catch(() => {});
			await server.stop();
			await pooler.stop();
		}
	});

	test("server without TLS responds N to SSLRequest and pg client falls back to plain", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const server = new PGliteTCPServer(pooler);
		await server.start(0 as unknown as number, "127.0.0.1");
		const addr = (
			server as unknown as { server: import("node:net").Server }
		).server.address() as { port: number };
		const port = addr.port;

		const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
			const s = net.createConnection({ host: "127.0.0.1", port }, () =>
				resolve(s),
			);
			s.once("error", reject);
		});

		const sslRequest = Buffer.alloc(8);
		sslRequest.writeInt32BE(8, 0);
		sslRequest.writeInt32BE(80877103, 4);
		rawSocket.write(sslRequest);

		const response = await new Promise<Buffer>((resolve) => {
			rawSocket.once("data", resolve);
		});
		assertEquals(response.toString(), "N");
		rawSocket.destroy();

		await server.stop();
		await pooler.stop();
	});

	test("server with TLS responds S to SSLRequest", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		const server = new PGliteTCPServer(pooler, undefined, {
			cert: Buffer.from(pems.cert),
			key: Buffer.from(pems.private),
		});
		await server.start(0 as unknown as number, "127.0.0.1");
		const addr = (
			server as unknown as { server: import("node:net").Server }
		).server.address() as { port: number };
		const port = addr.port;

		const rawSocket = await new Promise<net.Socket>((resolve, reject) => {
			const s = net.createConnection({ host: "127.0.0.1", port }, () =>
				resolve(s),
			);
			s.once("error", reject);
		});

		const sslRequest = Buffer.alloc(8);
		sslRequest.writeInt32BE(8, 0);
		sslRequest.writeInt32BE(80877103, 4);
		rawSocket.write(sslRequest);

		const response = await new Promise<Buffer>((resolve) => {
			rawSocket.once("data", resolve);
		});
		assertEquals(response.toString(), "S");
		rawSocket.destroy();

		await server.stop();
		await pooler.stop();
	});
});

describe("PGliteTCPMuxServer with TLS", () => {
	test("pg client connects to tenant over TLS", async () => {
		const db = new PGlite();
		const pooler = await PGlitePooler.create(db);
		await db.query("CREATE TABLE items (name TEXT)");
		await db.query("INSERT INTO items VALUES ('tls-works')");

		const mux = new PGliteTCPMuxServer(
			async (user) => {
				if (user === "tenant") return { pooler, password: "" };
				return null;
			},
			{ tls: { cert: Buffer.from(pems.cert), key: Buffer.from(pems.private) } },
		);
		await mux.start(0 as unknown as number, "127.0.0.1");
		const addr = (
			mux as unknown as { server: import("node:net").Server }
		).server.address() as { port: number };
		const port = addr.port;

		const client = new pg.Client({
			host: "127.0.0.1",
			port,
			user: "tenant",
			database: "postgres",
			ssl: { ca: pems.cert, rejectUnauthorized: true },
		});
		try {
			await client.connect();
			const res = await client.query("SELECT name FROM items");
			assertEquals(res.rows[0].name, "tls-works");
		} finally {
			await client.end().catch(() => {});
			await mux.stop();
			await pooler.stop();
		}
	});
});

describe("HTTPS server via node:https", () => {
	let httpsServer: import("node:https").Server;
	let httpsPort: number;

	beforeAll(async () => {
		httpsServer = https.createServer(
			{ cert: pems.cert, key: pems.private, minVersion: "TLSv1.2" },
			(_req, res) => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			},
		);
		await new Promise<void>((resolve) => {
			httpsServer.listen(0, "127.0.0.1", () => {
				httpsPort = (httpsServer.address() as { port: number }).port;
				resolve();
			});
		});
	});

	afterAll(() => {
		httpsServer.close();
	});

	test("HTTPS request with CA cert validates and receives JSON response", async () => {
		const res = await new Promise<{ status: number; body: string }>(
			(resolve, reject) => {
				const req = https.request(
					{
						hostname: "127.0.0.1",
						port: httpsPort,
						path: "/health",
						method: "GET",
						ca: pems.cert,
						rejectUnauthorized: true,
					},
					(response) => {
						let body = "";
						response.on("data", (chunk: Buffer) => {
							body += chunk.toString();
						});
						response.on("end", () =>
							resolve({ status: response.statusCode ?? 0, body }),
						);
					},
				);
				req.once("error", reject);
				req.end();
			},
		);

		assertEquals(res.status, 200);
		assertEquals((JSON.parse(res.body) as { ok: boolean }).ok, true);
	});
});
