import type { NanoSupabaseInstance } from "./nano.ts";
import { createSupabaseMcpServer } from "@supabase/mcp-server-supabase";
import type { SupabasePlatform } from "@supabase/mcp-server-supabase";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export interface McpServerConfig {
  httpPort: number;
  serviceRoleKey: string;
  anonKey: string;
}

function pgTypeToTs(pgType: string): string {
  if (
    pgType.includes("int") ||
    pgType.includes("numeric") ||
    pgType.includes("float") ||
    pgType.includes("double") ||
    pgType.includes("real") ||
    pgType.includes("decimal")
  )
    return "number";
  if (pgType.includes("bool")) return "boolean";
  if (pgType === "json" || pgType === "jsonb") return "Json";
  if (
    pgType.includes("timestamp") ||
    pgType.includes("date") ||
    pgType.includes("time")
  )
    return "string";
  return "string";
}

async function ensureMigrationsTable(db: NanoSupabaseInstance["db"]): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _nano_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

import { LINT_SQL } from "./lints.ts";

interface LintResult {
  name: string;
  title: string;
  level: string;
  categories: string[];
  description: string;
  detail?: string;
  schema?: string;
  table?: string;
  metadata?: Record<string, unknown>;
}

async function runLints(db: NanoSupabaseInstance["db"]): Promise<LintResult[]> {
  try {
    const sql = `set local pgrst.db_schemas = 'public,storage,graphql_public';\n${LINT_SQL}`;
    const results = await db.exec(sql);
    const lastResult = results[results.length - 1];
    if (!lastResult?.rows) return [];
    return lastResult.rows as unknown as LintResult[];
  } catch {
    return [];
  }
}

function buildPlatform(
  nano: NanoSupabaseInstance,
  config: McpServerConfig,
): SupabasePlatform {
  const { db } = nano;

  return {
    database: {
      async executeSql<T>(_projectId: string, options: { query: string; parameters?: unknown[]; read_only?: boolean }): Promise<T[]> {
        const { query, parameters = [] } = options;
        try {
          const result = await db.query(query, parameters);
          return result.rows as T[];
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("cannot insert multiple commands into a prepared statement")) {
            await db.exec(query);
            return [];
          }
          throw e;
        }
      },

      async listMigrations(_projectId: string) {
        await ensureMigrationsTable(db);
        const result = await db.query<{ name: string; applied_at: string }>(
          `SELECT name, applied_at FROM _nano_migrations ORDER BY applied_at`,
        );
        return result.rows.map((r) => ({ version: r.applied_at, name: r.name }));
      },

      async applyMigration(_projectId: string, options: { name: string; query: string }): Promise<void> {
        await ensureMigrationsTable(db);
        await db.exec(options.query);
        await db.query(
          `INSERT INTO _nano_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [options.name],
        );
      },
    },

    development: {
      async getProjectUrl(_projectId: string): Promise<string> {
        return `http://localhost:${config.httpPort}`;
      },

      async getPublishableKeys(_projectId: string) {
        return [
          { name: "anon", api_key: config.anonKey, type: "publishable" as const },
          { name: "service_role", api_key: config.serviceRoleKey, type: "legacy" as const },
        ];
      },

      async generateTypescriptTypes(_projectId: string) {
        const result = await db.query<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
           FROM information_schema.columns
           WHERE table_schema = 'public'
           ORDER BY table_name, ordinal_position`,
        );

        const tables: Record<string, Array<{ name: string; type: string; nullable: boolean }>> = {};
        for (const row of result.rows) {
          if (!tables[row.table_name]) tables[row.table_name] = [];
          tables[row.table_name]!.push({
            name: row.column_name,
            type: pgTypeToTs(row.data_type),
            nullable: row.is_nullable === "YES",
          });
        }

        const lines: string[] = [
          "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
          "",
          "export interface Database {",
          "  public: {",
          "    Tables: {",
        ];
        for (const [tableName, cols] of Object.entries(tables)) {
          lines.push(`      ${tableName}: {`, "        Row: {");
          for (const col of cols)
            lines.push(`          ${col.name}: ${col.type}${col.nullable ? " | null" : ""};`);
          lines.push("        };", "        Insert: {");
          for (const col of cols)
            lines.push(`          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`);
          lines.push("        };", "        Update: {");
          for (const col of cols)
            lines.push(`          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`);
          lines.push("        };", "      };");
        }
        lines.push("    };", "    Views: {};", "    Functions: {};", "    Enums: {};", "  };", "}");

        return { types: lines.join("\n") };
      },
    },

    debugging: {
      async getLogs(_projectId: string, _options: unknown) { return []; },
      async getSecurityAdvisors(_projectId: string) {
        const lints = await runLints(db);
        return lints.filter((l) => l.categories.includes("SECURITY"));
      },
      async getPerformanceAdvisors(_projectId: string) {
        const lints = await runLints(db);
        return lints.filter((l) => l.categories.includes("PERFORMANCE"));
      },
    },
  };
}

export interface McpHandler {
  handleRequest: (req: Request) => Promise<Response>;
}

export function createMcpHandler(
  nano: NanoSupabaseInstance,
  config: McpServerConfig,
): McpHandler {
  const platform = buildPlatform(nano, config);
  const sessions = new Map<string, {
    transport: WebStandardStreamableHTTPServerTransport;
    server: ReturnType<typeof createSupabaseMcpServer>;
  }>();

  return {
    async handleRequest(req: Request): Promise<Response> {
      const sessionId = req.headers.get("mcp-session-id");

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        return session.transport.handleRequest(req);
      }

      if (sessionId && !sessions.has(sessionId)) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server: mcpServer });
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });

      const mcpServer = createSupabaseMcpServer({
        platform,
        projectId: "local",
        features: ["database", "development", "debugging"],
      });

      await mcpServer.connect(transport);
      return transport.handleRequest(req);
    },
  };
}
