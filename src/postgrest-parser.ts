import { createClient } from "postgrest-parser/pkg/client.js";
import init, {
  initSchemaFromDb,
} from "postgrest-parser/pkg/postgrest_parser.js";
import type { QueryResult as ParserQueryResult } from "postgrest-parser/pkg/types.js";

export type QueryExecutor = (sql: string) => Promise<{ rows: unknown[] }>;

export interface ParsedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly tables: readonly string[];
}

export class PostgrestParser {
  private readonly client: ReturnType<typeof createClient>;
  private static initPromise: Promise<unknown> | null = null;

  constructor() {
    this.client = createClient();
  }

  static async init(wasmBytes?: Uint8Array): Promise<void> {
    if (!PostgrestParser.initPromise) {
      PostgrestParser.initPromise = wasmBytes
        ? init({ module_or_path: wasmBytes.buffer as ArrayBuffer })
        : init();
    }
    await PostgrestParser.initPromise;
  }

  static async initSchema(queryExecutor: QueryExecutor): Promise<void> {
    await PostgrestParser.init();
    await initSchemaFromDb(queryExecutor);
  }

  parseSelect(table: string, queryString: string = ""): ParsedQuery {
    return this.parseRequest("GET", table, queryString);
  }

  parseInsert(
    table: string,
    data: Record<string, unknown>,
    queryString: string = "",
  ): ParsedQuery {
    return this.parseRequest("POST", table, queryString, data);
  }

  parseUpdate(
    table: string,
    data: Record<string, unknown>,
    queryString: string,
  ): ParsedQuery {
    return this.parseRequest("PATCH", table, queryString, data);
  }

  parseDelete(table: string, queryString: string): ParsedQuery {
    return this.parseRequest("DELETE", table, queryString);
  }

  parseRpc(
    functionName: string,
    args?: Record<string, unknown>,
    queryString: string = "",
  ): ParsedQuery {
    const path = `rpc/${functionName}`;
    return this.parseRequest("POST", path, queryString, args);
  }

  parseRequest(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    queryString: string = "",
    body?: Record<string, unknown>,
  ): ParsedQuery {
    const result = this.client.parseRequest(
      method,
      path,
      queryString,
      body ?? null,
      null,
    );
    return this.convertResult(result);
  }

  private convertResult(result: ParserQueryResult): ParsedQuery {
    return {
      sql: result.query,
      params: Array.isArray(result.params) ? result.params : [],
      tables: Array.isArray(result.tables) ? result.tables : [],
    };
  }
}
