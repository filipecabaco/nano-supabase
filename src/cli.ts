#!/usr/bin/env bun

import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Extension } from "@electric-sql/pglite";

import { pgliteWasm, pgliteData, pgcryptoBundle, uuidOsspBundle, postgrestWasm } from "./cli-assets.ts";
import { nanoSupabase } from "./nano.ts";

const DEFAULT_HTTP_PORT = 54321;
const DEFAULT_TCP_PORT = 5432;
const DEFAULT_ANON_KEY = "local-anon-key";

const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log(`nano-supabase — local Supabase-compatible server

Usage: nano-supabase [options]

Options:
  --data-dir=<path>    Persistence directory (default: in-memory)
  --http-port=<port>   HTTP API port (default: ${DEFAULT_HTTP_PORT})
  --tcp-port=<port>    Postgres TCP port (default: ${DEFAULT_TCP_PORT})
  --debug              Enable debug logging
  --help               Show this help
  --version            Show version`);
  process.exit(0);
}

if (args.includes("--version")) {
  console.log("0.1.0");
  process.exit(0);
}

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`Invalid ${name}: "${raw}" (must be 1–65535)`);
    process.exit(1);
  }
  return n;
}

const httpPort = parsePort(
  args.find((a) => a.startsWith("--http-port="))?.split("=")[1],
  DEFAULT_HTTP_PORT,
  "--http-port",
);
const tcpPort = parsePort(
  args.find((a) => a.startsWith("--tcp-port="))?.split("=")[1],
  DEFAULT_TCP_PORT,
  "--tcp-port",
);
const dataDir = args.find((a) => a.startsWith("--data-dir="))?.split("=")[1];
const debug = args.includes("--debug");

const tmpDir = mkdtempSync(join(tmpdir(), "nano-supabase-"));
writeFileSync(join(tmpDir, "pgcrypto.tar.gz"), Buffer.from(pgcryptoBundle));
writeFileSync(join(tmpDir, "uuid-ossp.tar.gz"), Buffer.from(uuidOsspBundle));

const pgcryptoExt: Extension = {
  name: "pgcrypto",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(tmpDir, "pgcrypto.tar.gz")}`),
  }),
};
const uuidOsspExt: Extension = {
  name: "uuid-ossp",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(tmpDir, "uuid-ossp.tar.gz")}`),
  }),
};

// b64() creates a fresh Uint8Array owning its buffer (byteOffset === 0), so the cast is safe
const wasmModule = await WebAssembly.compile(pgliteWasm.buffer as ArrayBuffer);
const fsBundle = new Blob([pgliteData]);

const nano = await nanoSupabase({
  dataDir,
  tcp: { port: tcpPort },
  debug,
  wasmModule,
  fsBundle,
  postgrestWasmBytes: postgrestWasm,
  extensions: { pgcrypto: pgcryptoExt, uuid_ossp: uuidOsspExt },
});

const server = Bun.serve({
  port: httpPort,
  fetch: (req: Request) => nano.localFetch(req),
});

console.log("nano-supabase running\n");
console.log("supabase-js:");
console.log(`  url:      http://localhost:${httpPort}`);
console.log(`  anon key: ${DEFAULT_ANON_KEY}\n`);
console.log("psql:");
console.log(`  ${nano.connectionString}\n`);
console.log("Press Ctrl+C to stop.");

function cleanup(): void {
  try {
    unlinkSync(join(tmpDir, "pgcrypto.tar.gz"));
    unlinkSync(join(tmpDir, "uuid-ossp.tar.gz"));
    rmdirSync(tmpDir);
  } catch (_: unknown) {
    // best-effort cleanup
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.stop();
    await nano.stop();
    cleanup();
    process.exit(0);
  });
}
