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

const LINT_SQL = /* SQL */ `
set local search_path = '';

(
with foreign_keys as (
    select
        cl.relnamespace::regnamespace::text as schema_name,
        cl.relname as table_name,
        cl.oid as table_oid,
        ct.conname as fkey_name,
        ct.conkey as col_attnums
    from
        pg_catalog.pg_constraint ct
        join pg_catalog.pg_class cl
            on ct.conrelid = cl.oid
        left join pg_catalog.pg_depend d
            on d.objid = cl.oid
            and d.deptype = 'e'
    where
        ct.contype = 'f'
        and d.objid is null
        and cl.relnamespace::regnamespace::text not in (
            'pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions'
        )
),
index_ as (
    select
        pi.indrelid as table_oid,
        indexrelid::regclass as index_,
        string_to_array(indkey::text, ' ')::smallint[] as col_attnums
    from
        pg_catalog.pg_index pi
    where
        indisvalid
)
select
    'unindexed_foreign_keys' as name,
    'Unindexed foreign keys' as title,
    'INFO' as level,
    'EXTERNAL' as facing,
    array['PERFORMANCE'] as categories,
    'Identifies foreign key constraints without a covering index, which can impact database performance.' as description,
    format(
        'Table \`%s.%s\` has a foreign key \`%s\` without a covering index. This can lead to slow queries.',
        fk.schema_name,
        fk.table_name,
        fk.fkey_name
    ) as detail,
    fk.schema_name as schema,
    fk.table_name as table,
    jsonb_build_object('fkey_name', fk.fkey_name, 'fkey_columns', fk.col_attnums) as metadata
from
    foreign_keys fk
    left join index_ idx
        on fk.table_oid = idx.table_oid
        and fk.col_attnums = idx.col_attnums
where
    idx.index_ is null
)

union all

(
select
    'no_primary_key' as name,
    'No primary key' as title,
    'INFO' as level,
    'EXTERNAL' as facing,
    array['PERFORMANCE'] as categories,
    'Tables without a primary key can be inefficient to interact with.' as description,
    format(
        'Table \`%s.%s\` does not have a primary key.',
        n.nspname,
        c.relname
    ) as detail,
    n.nspname::text as schema,
    c.relname::text as table,
    '{}'::jsonb as metadata
from
    pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_index i on i.indrelid = c.oid and i.indisprimary
    left join pg_catalog.pg_depend d on d.objid = c.oid and d.deptype = 'e'
where
    c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions', 'supabase_migrations')
    and d.objid is null
    and i.indrelid is null
)

union all

(
select
    'rls_disabled_in_public' as name,
    'RLS disabled in public' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array['SECURITY'] as categories,
    'Tables in the public schema with RLS disabled.' as description,
    format(
        'Table \`%s.%s\` is in the public schema with RLS disabled. This is a security risk.',
        n.nspname,
        c.relname
    ) as detail,
    n.nspname::text as schema,
    c.relname::text as table,
    '{}'::jsonb as metadata
from
    pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_depend d on d.objid = c.oid and d.deptype = 'e'
where
    c.relkind = 'r'
    and n.nspname = 'public'
    and d.objid is null
    and not c.relrowsecurity
)

union all

(
select
    'rls_enabled_no_policy' as name,
    'RLS enabled with no policies' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array['SECURITY'] as categories,
    'Tables with RLS enabled but no policies, blocking all access.' as description,
    format(
        'Table \`%s.%s\` has RLS enabled but no policies defined. All access is blocked.',
        n.nspname,
        c.relname
    ) as detail,
    n.nspname::text as schema,
    c.relname::text as table,
    '{}'::jsonb as metadata
from
    pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_policy p on p.polrelid = c.oid
    left join pg_catalog.pg_depend d on d.objid = c.oid and d.deptype = 'e'
where
    c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions')
    and d.objid is null
    and c.relrowsecurity
    and p.polrelid is null
)

union all

(
select
    'policy_exists_rls_disabled' as name,
    'Policy exists but RLS is not enabled' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array['SECURITY'] as categories,
    'Tables with RLS policies defined but RLS is not enabled, so policies have no effect.' as description,
    format(
        'Table \`%s.%s\` has RLS policies but RLS is not enabled.',
        n.nspname,
        c.relname
    ) as detail,
    n.nspname::text as schema,
    c.relname::text as table,
    '{}'::jsonb as metadata
from
    pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_policy p on p.polrelid = c.oid
    left join pg_catalog.pg_depend d on d.objid = c.oid and d.deptype = 'e'
where
    c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions')
    and d.objid is null
    and not c.relrowsecurity
group by n.nspname, c.relname
)

union all

(
select
    'duplicate_index' as name,
    'Duplicate index' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array['PERFORMANCE'] as categories,
    'Identifies indexes that have the same definition as another index.' as description,
    format(
        'Index \`%s\` on \`%s.%s\` is a duplicate.',
        a.indexrelid::regclass::text,
        n.nspname,
        c.relname
    ) as detail,
    n.nspname::text as schema,
    c.relname::text as table,
    jsonb_build_object('index_name', a.indexrelid::regclass::text) as metadata
from
    pg_catalog.pg_index a
    join pg_catalog.pg_class c on a.indrelid = c.oid
    join pg_catalog.pg_namespace n on c.relnamespace = n.oid
    left join pg_catalog.pg_depend d on d.objid = c.oid and d.deptype = 'e'
where
    n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions')
    and d.objid is null
    and exists (
        select 1
        from pg_catalog.pg_index b
        where a.indrelid = b.indrelid
          and a.indexrelid != b.indexrelid
          and a.indkey::text = b.indkey::text
          and a.indclass::text = b.indclass::text
          and a.indoption::text = b.indoption::text
          and coalesce(a.indexprs::text, '') = coalesce(b.indexprs::text, '')
          and coalesce(a.indpred::text, '') = coalesce(b.indpred::text, '')
          and a.indexrelid::text > b.indexrelid::text
    )
)

union all

(
select
    'extension_in_public' as name,
    'Extension in public schema' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array['SECURITY'] as categories,
    'Extensions installed in the public schema can pose security risks.' as description,
    format(
        'Extension \`%s\` is installed in the public schema.',
        e.extname
    ) as detail,
    n.nspname::text as schema,
    e.extname::text as table,
    '{}'::jsonb as metadata
from
    pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on e.extnamespace = n.oid
where
    n.nspname = 'public'
)
`;

async function runLints(db: NanoSupabaseInstance["db"]): Promise<LintResult[]> {
  try {
    const results = await db.exec(LINT_SQL);
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
