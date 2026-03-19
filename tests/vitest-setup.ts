import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PostgrestParser } from "../src/postgrest-parser.ts";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("postgrest-parser/pkg/postgrest_parser_bg.wasm");
const wasmBytes = readFileSync(wasmPath);
await PostgrestParser.init(new Uint8Array(wasmBytes));
