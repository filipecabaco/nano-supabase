import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Extension } from "@electric-sql/pglite";

import {
	cmdDbDump,
	cmdDbExec,
	cmdDbReset,
	cmdGenTypes,
	cmdMigrationList,
	cmdMigrationNew,
	cmdMigrationUp,
	cmdServiceAdd,
	cmdServiceList,
	cmdServicePause,
	cmdServiceRemove,
	cmdServiceResetPassword,
	cmdServiceResetToken,
	cmdServiceSql,
	cmdServiceWake,
	cmdStatus,
	cmdStop,
	cmdStorageCp,
	cmdStorageCreateBucket,
	cmdStorageListBuckets,
	cmdStorageLs,
	cmdSyncPull,
	cmdSyncPush,
	cmdUsersCreate,
	cmdUsersDelete,
	cmdUsersGet,
	cmdUsersList,
} from "./cli-commands.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pgliteDist = __dirname;

const DEFAULT_HTTP_PORT = 54321;
const DEFAULT_TCP_PORT = 5432;
const DEFAULT_ANON_KEY = "local-anon-key";
const DEFAULT_SERVICE_ROLE_KEY = "local-service-role-key";

const argv = process.argv.slice(2);

function getArgValue(args: string[], flag: string): string | undefined {
	const withEq = args.find((a) => a.startsWith(`${flag}=`));
	if (withEq) return withEq.slice(flag.length + 1);
	const idx = args.indexOf(flag);
	if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--"))
		return args[idx + 1];
	return undefined;
}

const SUB_COMMANDS = [
	"start",
	"stop",
	"status",
	"db",
	"migration",
	"users",
	"storage",
	"gen",
	"sync",
	"service",
];
const firstArg = argv[0];
const subCommand =
	firstArg && SUB_COMMANDS.includes(firstArg) ? firstArg : "start";
const subArgs =
	subCommand === "start" && firstArg !== "start" ? argv : argv.slice(1);

if (argv.includes("--help") || argv.includes("-h")) {
	console.log(`nano-supabase — local Supabase-compatible server

Usage: nano-supabase [command] [options]

Commands:
  start                 Start the server (default)
  stop                  Stop a detached server
  status                Check if server is running

  db exec               Execute SQL
  db dump               Dump schema DDL
  db reset              Drop all public tables

  migration new <name>  Create a new migration file
  migration list        List applied/pending migrations
  migration up          Apply pending migrations

  users list            List all users
  users create          Create a user
  users get <id>        Get a user by ID
  users delete <id>     Delete a user

  storage list-buckets       List storage buckets
  storage create-bucket <n>  Create a storage bucket
  storage ls <bucket>        List objects in bucket
  storage cp <src> <dst>     Upload or download files

  gen types             Generate TypeScript types

  sync push             Push local migrations and buckets to a remote Supabase project
  sync pull             Pull remote schema and buckets into local instance

  service               Run as a multi-tenant service (multiple isolated PGlite instances)

Service options:
  --service-port=<port>       HTTP listen port (default: 8080)
  --admin-token=<token>       Admin bearer token (required)
  --registry-db-url=<url>     Postgres URL for tenant registry (optional; defaults to local PGlite at <data-dir>/.registry; or NANO_REGISTRY_DB_URL env)
  --routing=<mode>            Routing mode: path (default) or subdomain
  --base-domain=<domain>      Base domain for subdomain routing (e.g. example.com → <slug>.example.com)
  --data-dir=<path>       Base dir for tenant data (default: /tmp/nano-service-data)
  --cold-dir=<path>       Disk offload cold storage dir (default: /tmp/nano-service-cold)
  --s3-bucket=<bucket>    S3 bucket name (enables S3 offload)
  --s3-endpoint=<url>     S3 custom endpoint URL
  --idle-timeout=<ms>     Idle timeout in ms (default: 600000)
  --idle-check=<ms>       Idle check interval in ms (default: 30000)
  --circuit-breaker-threshold=<n>  Auto-pause tenant after N consecutive 5xx responses (default: 10)

Sync options:
  --remote-url=<url>               Remote Supabase project URL (or SUPABASE_URL)
  --remote-service-role-key=<k>    Remote service role key (or SUPABASE_SERVICE_ROLE_KEY)
  --remote-db-url=<url>            Remote Postgres connection string (or SUPABASE_DB_URL)
  --no-migrations                  Skip migration sync
  --no-storage                     Skip storage bucket sync
  --dry-run                        Preview without writing

Start options:
  --data-dir=<path>            Persistence directory (default: in-memory)
  --http-port=<port>           HTTP API port (default: ${DEFAULT_HTTP_PORT})
  --tcp-port=<port>            Postgres TCP port (default: ${DEFAULT_TCP_PORT})
  --service-role-key=<key>     Service role key (default: ${DEFAULT_SERVICE_ROLE_KEY})
  --extensions=<names>         Comma-separated list of PGlite extensions to load (e.g. vector,pg_trgm)
  --count=<n>                  Start N instances (ports increment: httpPort+i, tcpPort+i; data dir: dataDir/i+1)
  --detach                     Run in background and print JSON connection info
  --pid-file=<path>            Write PID to additional file (default location: /tmp/nano-supabase-<port>.pid)
  --mcp                        Start MCP server on /mcp endpoint (Streamable HTTP transport)
  --debug                      Enable debug logging

Common options:
  --url=<url>                  Server URL (default: http://localhost:${DEFAULT_HTTP_PORT})
  --json                       Output raw JSON instead of human-readable text
  --help                       Show this help
  --version                    Show version`);
	process.exit(0);
}

if (argv.includes("--version")) {
	console.log("0.1.0");
	process.exit(0);
}

async function runSubCommand(): Promise<void> {
	let result: { exitCode: number; output: string };

	if (subCommand === "status") {
		result = await cmdStatus(subArgs);
	} else if (subCommand === "stop") {
		result = await cmdStop(subArgs);
	} else if (subCommand === "db") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "exec") result = await cmdDbExec(opArgs);
		else if (op === "dump") result = await cmdDbDump(opArgs);
		else if (op === "reset") result = await cmdDbReset(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown db command: ${op}`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "migration") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "new") result = await cmdMigrationNew(opArgs);
		else if (op === "list") result = await cmdMigrationList(opArgs);
		else if (op === "up") result = await cmdMigrationUp(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown migration command: ${op}`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "users") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "list") result = await cmdUsersList(opArgs);
		else if (op === "create") result = await cmdUsersCreate(opArgs);
		else if (op === "get") result = await cmdUsersGet(opArgs);
		else if (op === "delete") result = await cmdUsersDelete(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown users command: ${op}`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "storage") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "list-buckets") result = await cmdStorageListBuckets(opArgs);
		else if (op === "create-bucket")
			result = await cmdStorageCreateBucket(opArgs);
		else if (op === "ls") result = await cmdStorageLs(opArgs);
		else if (op === "cp") result = await cmdStorageCp(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown storage command: ${op}`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "gen") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "types") result = await cmdGenTypes(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown gen command: ${op}`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "sync") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "push") result = await cmdSyncPush(opArgs);
		else if (op === "pull") result = await cmdSyncPull(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown sync operation: ${op}. Use push or pull.`,
				})}\n`,
			);
			process.exit(1);
		}
	} else if (subCommand === "service") {
		const op = subArgs[0];
		const opArgs = subArgs.slice(1);
		if (op === "add") result = await cmdServiceAdd(opArgs);
		else if (op === "list") result = await cmdServiceList(opArgs);
		else if (op === "remove") result = await cmdServiceRemove(opArgs);
		else if (op === "pause") result = await cmdServicePause(opArgs);
		else if (op === "wake") result = await cmdServiceWake(opArgs);
		else if (op === "sql") result = await cmdServiceSql(opArgs);
		else if (op === "reset-token") result = await cmdServiceResetToken(opArgs);
		else if (op === "reset-password")
			result = await cmdServiceResetPassword(opArgs);
		else {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_command",
					message: `Unknown service command: ${op}. Use add, list, remove, pause, wake, sql, reset-token, or reset-password.`,
				})}\n`,
			);
			process.exit(1);
		}
	} else {
		process.stderr.write(
			`${JSON.stringify({
				error: "unknown_command",
				message: `Unknown command: ${subCommand}`,
			})}\n`,
		);
		process.exit(1);
	}

	if (result?.exitCode !== 0) {
		process.stderr.write(`${result?.output}\n`);
	} else {
		process.stdout.write(`${result?.output}\n`);
	}
	process.exit(result?.exitCode);
}

const SERVICE_MGMT_OPS = [
	"add",
	"list",
	"remove",
	"pause",
	"wake",
	"sql",
	"reset-token",
	"reset-password",
];

const isServiceMgmtOp =
	subCommand === "service" && SERVICE_MGMT_OPS.includes(subArgs[0]);

if (subCommand !== "start" && subCommand !== "service") {
	await runSubCommand();
} else if (isServiceMgmtOp) {
	await runSubCommand();
}

function parsePort(
	raw: string | undefined,
	fallback: number,
	name: string,
): number {
	if (raw === undefined) return fallback;
	const n = parseInt(raw, 10);
	if (!Number.isInteger(n) || n < 1 || n > 65535) {
		process.stderr.write(`Invalid ${name}: "${raw}" (must be 1–65535)\n`);
		process.exit(1);
	}
	return n;
}

const httpPort = parsePort(
	getArgValue(subArgs, "--http-port"),
	DEFAULT_HTTP_PORT,
	"--http-port",
);
const tcpPort = parsePort(
	getArgValue(subArgs, "--tcp-port"),
	DEFAULT_TCP_PORT,
	"--tcp-port",
);
const dataDir = getArgValue(subArgs, "--data-dir");
const tlsCert =
	getArgValue(subArgs, "--tls-cert") ?? process.env.NANO_TLS_CERT;
const tlsKey = getArgValue(subArgs, "--tls-key") ?? process.env.NANO_TLS_KEY;
if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
	process.stderr.write(
		`${JSON.stringify({
			error: "invalid_tls_config",
			message: "--tls-cert and --tls-key must both be provided together",
		})}\n`,
	);
	process.exit(1);
}
const serviceRoleKey =
	getArgValue(subArgs, "--service-role-key") ??
	process.env.NANO_SUPABASE_SERVICE_ROLE_KEY ??
	DEFAULT_SERVICE_ROLE_KEY;
const debug = subArgs.includes("--debug");
const detach = subArgs.includes("--detach");
const mcp = subArgs.includes("--mcp");
const pidFile = getArgValue(subArgs, "--pid-file");
const count = (() => {
	const raw = getArgValue(subArgs, "--count");
	if (raw === undefined) return 1;
	const n = parseInt(raw, 10);
	if (!Number.isInteger(n) || n < 1) {
		process.stderr.write(`Invalid --count: "${raw}" (must be >= 1)\n`);
		process.exit(1);
	}
	return n;
})();
const extensionNames = (getArgValue(subArgs, "--extensions") ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

if (detach) {
	const serverArgs = subArgs.filter((a) => a !== "--detach");
	const child = spawn(
		process.execPath,
		[process.argv[1], "start", ...serverArgs],
		{
			detached: true,
			stdio: "ignore",
		},
	);
	child.unref();

	const serverUrl = `http://localhost:${httpPort}`;
	for (let i = 0; i < 120; i++) {
		await new Promise((r) => setTimeout(r, 250));
		try {
			const res = await fetch(`${serverUrl}/health`);
			if (res.ok) {
				const output = {
					url: serverUrl,
					anon_key: DEFAULT_ANON_KEY,
					service_role_key: serviceRoleKey,
					pg: `postgresql://postgres@127.0.0.1:${tcpPort}/postgres`,
					pid: child.pid,
				};
				process.stdout.write(`${JSON.stringify(output)}\n`);
				process.exit(0);
			}
		} catch {}
	}
	process.stderr.write(
		`${JSON.stringify({
			error: "start_timeout",
			message: "Server did not start within 30s",
		})}\n`,
	);
	process.exit(1);
}

const wasmModule = await WebAssembly.compile(
	await readFile(join(pgliteDist, "pglite.wasm")),
);
const fsBundle = new Blob([await readFile(join(pgliteDist, "pglite.data"))]);
const postgrestWasm = new Uint8Array(
	await readFile(join(__dirname, "postgrest_parser_bg.wasm")),
);

const pgcryptoExt: Extension = {
	name: "pgcrypto",
	setup: async (_pg, _emscriptenOpts) => ({
		bundlePath: new URL(`file://${join(pgliteDist, "pgcrypto.tar.gz")}`),
	}),
};
const uuidOsspExt: Extension = {
	name: "uuid-ossp",
	setup: async (_pg, _emscriptenOpts) => ({
		bundlePath: new URL(`file://${join(pgliteDist, "uuid-ossp.tar.gz")}`),
	}),
};

const _require = createRequire(import.meta.url);
const pglitePackageDist = dirname(_require.resolve("@electric-sql/pglite"));

const extraExtensions: Record<string, Extension> = {};
for (const name of extensionNames) {
	let tarPath = join(pgliteDist, `${name}.tar.gz`);
	try {
		await readFile(tarPath);
	} catch {
		const fallback = join(pglitePackageDist, `${name}.tar.gz`);
		try {
			await readFile(fallback);
			tarPath = fallback;
		} catch {
			process.stderr.write(
				`${JSON.stringify({
					error: "unknown_extension",
					message: `Extension "${name}" not found. Available extensions are listed at https://pglite.dev/extensions/`,
				})}\n`,
			);
			process.exit(1);
		}
	}
	const resolvedPath = tarPath;
	extraExtensions[name.replace(/-/g, "_")] = {
		name,
		setup: async (_pg, _emscriptenOpts) => ({
			bundlePath: new URL(`file://${resolvedPath}`),
		}),
	};
}

if (subCommand === "service" && !isServiceMgmtOp) {
	const { runServiceMode } = await import("./cli-service.ts");
	await runServiceMode({
		wasmModule,
		fsBundle,
		postgrestWasm,
		pgcryptoExt,
		uuidOsspExt,
		subArgs,
		parsePort,
		getArgValue,
		DEFAULT_SERVICE_ROLE_KEY,
		DEFAULT_ANON_KEY,
		pgliteDist,
	});
} else {
	const { runStartMode } = await import("./cli-server.ts");
	await runStartMode({
		wasmModule,
		fsBundle,
		postgrestWasm,
		pgcryptoExt,
		uuidOsspExt,
		extraExtensions,
		subArgs,
		httpPort,
		tcpPort,
		dataDir,
		serviceRoleKey,
		anonKey: DEFAULT_ANON_KEY,
		debug,
		mcp,
		pidFile,
		count,
		tlsCert,
		tlsKey,
	});
}
