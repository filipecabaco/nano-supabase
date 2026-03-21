// @ts-ignore - Vite ?url suffix
import wasmUrl from "postgrest-parser/pkg/postgrest_parser_bg.wasm?url";
import { PostgrestParser } from "../../src/postgrest-parser.ts";

const response = await fetch(wasmUrl);
const wasmBytes = new Uint8Array(await response.arrayBuffer());
await PostgrestParser.init(wasmBytes);
