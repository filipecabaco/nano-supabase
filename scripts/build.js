import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const target = process.argv[2];

const NODE_EXTERNALS = [
  "node:*",
  "net",
  "tls",
  "crypto",
  "node:net",
  "node:tls",
  "node:crypto",
];

const commonOptions = {
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  treeShaking: true,
  sourcemap: true,
  conditions: ["import", "module", "default"],
  mainFields: ["module", "main"],
};

async function buildLib() {
  console.log("Building lib...");
  await esbuild.build({
    ...commonOptions,
    external: ["@electric-sql/pglite", ...NODE_EXTERNALS],
    platform: "neutral",
    splitting: true,
    entryPoints: [
      { in: join(rootDir, "src/index.ts"), out: "index" },
      { in: join(rootDir, "src/tcp.ts"), out: "tcp" },
    ],
    outdir: join(rootDir, "dist"),
  });
  const fs = await import("node:fs");
  console.log(
    `  dist/index.js  ${(fs.statSync(join(rootDir, "dist/index.js")).size / 1024) | 0}KB`,
  );
  console.log(
    `  dist/tcp.js    ${(fs.statSync(join(rootDir, "dist/tcp.js")).size / 1024) | 0}KB`,
  );
}

async function buildCli() {
  console.log("Building cli...");
  await esbuild.build({
    ...commonOptions,
    external: [...NODE_EXTERNALS, "pg", "pg-native", "node-pg-migrate"],
    platform: "node",
    entryPoints: [join(rootDir, "src/cli.ts")],
    outfile: join(rootDir, "dist/cli.js"),
    banner: { js: "#!/usr/bin/env node" },
  });
  chmodSync(join(rootDir, "dist/cli.js"), 0o755);

  const pgliteDistDir = join(rootDir, "node_modules/@electric-sql/pglite/dist");
  for (const file of [
    "pglite.wasm",
    "initdb.wasm",
    "pglite.data",
    "pgcrypto.tar.gz",
    "uuid-ossp.tar.gz",
  ]) {
    copyFileSync(join(pgliteDistDir, file), join(rootDir, "dist", file));
  }
  copyFileSync(
    join(rootDir, "node_modules/postgrest-parser/pkg/postgrest_parser_bg.wasm"),
    join(rootDir, "dist/postgrest_parser_bg.wasm"),
  );
  cpSync(
    join(rootDir, "src/service-migrations"),
    join(rootDir, "dist/service-migrations"),
    { recursive: true },
  );
  console.log(
    `  dist/cli.js    ${((await import("node:fs")).statSync(join(rootDir, "dist/cli.js")).size / 1024) | 0}KB`,
  );
}

async function build() {
  rmSync(join(rootDir, "dist"), { recursive: true, force: true });
  mkdirSync(join(rootDir, "dist"), { recursive: true });

  if (target === "lib") {
    await buildLib();
  } else if (target === "cli") {
    await buildCli();
  } else {
    await buildLib();
    await buildCli();
  }

  console.log("Done.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
