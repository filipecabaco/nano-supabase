import type { PGliteInterface } from "@electric-sql/pglite";

export interface MigrateResult {
  schema: {
    tables: number;
    migrations: number;
    views: number;
    functions: number;
    triggers: number;
    policies: number;
  };
  auth: { users: number; identities: number };
  data: { tables: number; rows: number };
  storage: { buckets: number; objects: number };
}

export interface MigrateOptions {
  skipSchema?: boolean;
  skipAuth?: boolean;
  skipData?: boolean;
  skipStorage?: boolean;
  dryRun?: boolean;
  migrationsDir?: string;
}

export interface StorageTransfer {
  download: (
    bucketId: string,
    name: string,
  ) => Promise<{ data: ArrayBuffer; contentType: string } | null>;
  upload: (
    bucketId: string,
    name: string,
    data: ArrayBuffer,
    contentType: string,
  ) => Promise<boolean>;
}

type QueryResult = { rows: Record<string, unknown>[] };
export type ExecuteOnTarget = (
  sql: string,
  params?: unknown[],
) => Promise<QueryResult>;

export async function migrateDatabase(
  sourceDb: PGliteInterface,
  executeOnTarget: ExecuteOnTarget,
  options: MigrateOptions,
  storageTransfer?: StorageTransfer,
): Promise<MigrateResult> {
  const result: MigrateResult = {
    schema: {
      tables: 0,
      migrations: 0,
      views: 0,
      functions: 0,
      triggers: 0,
      policies: 0,
    },
    auth: { users: 0, identities: 0 },
    data: { tables: 0, rows: 0 },
    storage: { buckets: 0, objects: 0 },
  };

  await executeOnTarget("SET search_path = public").catch(() => {});

  if (!options.skipSchema) {
    const { existsSync, readdirSync } = await import("node:fs");
    const { readFile: readFileFn } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const migDir = options.migrationsDir ?? "./supabase/migrations";
    const migPattern = /^(\d+)_.*\.sql$/;

    let usedMigrationFiles = false;
    if (existsSync(migDir)) {
      const files = readdirSync(migDir)
        .filter((f: string) => migPattern.test(f))
        .sort();
      if (files.length > 0) {
        usedMigrationFiles = true;
        await executeOnTarget(
          "CREATE SCHEMA IF NOT EXISTS supabase_migrations",
        ).catch(() => {});
        await executeOnTarget(
          `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
        ).catch(() => {});
        const appliedRes = await executeOnTarget(
          "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
        ).catch(() => ({ rows: [] }) as QueryResult);
        const applied = new Set(
          appliedRes.rows.map((r) => r.version as string),
        );
        for (const file of files) {
          const match = file.match(migPattern) ?? [];
          const version = match[1] ?? "";
          const name = file.replace(/\.sql$/, "").slice(version.length + 1);
          if (applied.has(version)) continue;
          const sql = await readFileFn(join(migDir, file), "utf8");
          const statements = sql
            .split(";")
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (!options.dryRun) {
            for (const stmt of statements) await executeOnTarget(stmt);
            await executeOnTarget(
              "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
              [version, name, statements],
            );
          }
          result.schema.migrations++;
        }
      }
    }

    if (!usedMigrationFiles) {
      const hasMigTable = await sourceDb
        .query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations') AS exists`,
        )
        .then((r) => r.rows[0]?.exists ?? false)
        .catch(() => false);
      if (hasMigTable) {
        const migRows = await sourceDb.query<{
          version: string;
          name: string | null;
          statements: string[] | null;
        }>(
          "SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version",
        );
        if (migRows.rows.length > 0) {
          usedMigrationFiles = true;
          await executeOnTarget(
            "CREATE SCHEMA IF NOT EXISTS supabase_migrations",
          ).catch(() => {});
          await executeOnTarget(
            `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
          ).catch(() => {});
          const appliedRes = await executeOnTarget(
            "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
          ).catch(() => ({ rows: [] }) as QueryResult);
          const applied = new Set(
            appliedRes.rows.map((r) => r.version as string),
          );
          for (const row of migRows.rows) {
            if (applied.has(row.version)) continue;
            const stmts = row.statements ?? [];
            if (!options.dryRun) {
              for (const stmt of stmts) await executeOnTarget(stmt);
              await executeOnTarget(
                "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
                [row.version, row.name, stmts],
              );
            }
            result.schema.migrations++;
          }
        }
      }
    }

    if (!usedMigrationFiles) {
      const enumsRes = await sourceDb.query<{
        typname: string;
        labels: string;
      }>(
        `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) as labels
				 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
				 JOIN pg_namespace n ON t.typnamespace = n.oid
				 WHERE n.nspname = 'public' GROUP BY t.typname`,
      );
      for (const en of enumsRes.rows) {
        const vals = en.labels
          .split(",")
          .map((l: string) => `'${l.replace(/'/g, "''")}'`)
          .join(", ");
        if (!options.dryRun)
          await executeOnTarget(
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${en.typname}') THEN CREATE TYPE "${en.typname}" AS ENUM (${vals}); END IF; END $$`,
          ).catch(() => {});
      }

      const seqRes = await sourceDb.query<{
        sequence_name: string;
      }>(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'",
      );
      for (const seq of seqRes.rows) {
        if (!options.dryRun)
          await executeOnTarget(
            `CREATE SEQUENCE IF NOT EXISTS "${seq.sequence_name}"`,
          ).catch(() => {});
      }

      const tablesRes = await sourceDb.query<{
        table_name: string;
      }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
      );

      for (const tbl of tablesRes.rows) {
        const tn = tbl.table_name;
        const colsRes = await sourceDb.query<{
          column_name: string;
          data_type: string;
          udt_name: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
          numeric_precision: number | null;
          numeric_scale: number | null;
        }>(
          "SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tn],
        );

        const colDefs: string[] = [];
        for (const c of colsRes.rows) {
          let typeStr =
            c.data_type === "USER-DEFINED" ? `"${c.udt_name}"` : c.data_type;
          if (
            c.character_maximum_length &&
            (c.data_type === "character varying" ||
              c.data_type === "character")
          )
            typeStr += `(${c.character_maximum_length})`;
          if (
            c.numeric_precision &&
            c.numeric_scale &&
            c.data_type === "numeric"
          )
            typeStr += `(${c.numeric_precision}, ${c.numeric_scale})`;
          let def = `"${c.column_name}" ${typeStr}`;
          if (c.column_default !== null) def += ` DEFAULT ${c.column_default}`;
          if (c.is_nullable === "NO") def += " NOT NULL";
          colDefs.push(def);
        }

        const pkRes = await sourceDb.query<{
          column_name: string;
        }>(
          `SELECT kcu.column_name FROM information_schema.table_constraints tc
					 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
					 WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
					 ORDER BY kcu.ordinal_position`,
          [tn],
        );
        if (pkRes.rows.length > 0)
          colDefs.push(
            `PRIMARY KEY (${pkRes.rows.map((r) => `"${r.column_name}"`).join(", ")})`,
          );

        const uqRes = await sourceDb.query<{
          constraint_name: string;
          column_name: string;
        }>(
          `SELECT tc.constraint_name, kcu.column_name FROM information_schema.table_constraints tc
					 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
					 WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
					 ORDER BY tc.constraint_name, kcu.ordinal_position`,
          [tn],
        );
        const uniqueGroups: Record<string, string[]> = {};
        for (const r of uqRes.rows) {
          const cn = r.constraint_name as string;
          if (!uniqueGroups[cn]) uniqueGroups[cn] = [];
          uniqueGroups[cn]!.push(`"${r.column_name}"`);
        }
        for (const cols of Object.values(uniqueGroups))
          colDefs.push(`UNIQUE (${cols.join(", ")})`);

        const fkRes = await sourceDb.query<{
          constraint_name: string;
          column_name: string;
          foreign_table_schema: string;
          foreign_table_name: string;
          foreign_column_name: string;
        }>(
          `SELECT tc.constraint_name, kcu.column_name,
					        ccu.table_schema AS foreign_table_schema,
					        ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
					 FROM information_schema.table_constraints tc
					 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
					 JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
					 WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
          [tn],
        );
        for (const fk of fkRes.rows) {
          const ref =
            fk.foreign_table_schema !== "public"
              ? `"${fk.foreign_table_schema}"."${fk.foreign_table_name}"`
              : `"${fk.foreign_table_name}"`;
          colDefs.push(
            `FOREIGN KEY ("${fk.column_name}") REFERENCES ${ref}("${fk.foreign_column_name}")`,
          );
        }

        const ddl = `CREATE TABLE IF NOT EXISTS "${tn}" (\n  ${colDefs.join(",\n  ")}\n)`;
        if (!options.dryRun) await executeOnTarget(ddl);
        result.schema.tables++;
      }

      const idxRes = await sourceDb.query<{
        indexname: string;
        indexdef: string;
      }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'",
      );
      for (const idx of idxRes.rows) {
        if (!options.dryRun) {
          const safeIdx = (idx.indexdef as string).replace(
            /CREATE INDEX/,
            "CREATE INDEX IF NOT EXISTS",
          );
          await executeOnTarget(safeIdx).catch(() => {});
        }
      }

      const viewsRes = await sourceDb.query<{
        viewname: string;
        definition: string;
      }>(
        "SELECT viewname, definition FROM pg_views WHERE schemaname = 'public'",
      );
      for (const v of viewsRes.rows) {
        if (!options.dryRun)
          await executeOnTarget(
            `CREATE OR REPLACE VIEW "${v.viewname}" AS ${v.definition}`,
          ).catch(() => {});
        result.schema.views++;
      }

      const funcsRes = await sourceDb.query<{
        proname: string;
        func_def: string;
      }>(
        `SELECT p.proname, pg_get_functiondef(p.oid) AS func_def
				 FROM pg_proc p
				 JOIN pg_namespace n ON p.pronamespace = n.oid
				 WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')`,
      );
      for (const fn of funcsRes.rows) {
        if (!options.dryRun)
          await executeOnTarget(`${fn.func_def};`).catch(() => {});
        result.schema.functions++;
      }

      const triggersRes = await sourceDb.query<{
        trigger_def: string;
      }>(
        `SELECT pg_get_triggerdef(t.oid) AS trigger_def
				 FROM pg_trigger t
				 JOIN pg_class c ON t.tgrelid = c.oid
				 JOIN pg_namespace n ON c.relnamespace = n.oid
				 WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
      );
      for (const tr of triggersRes.rows) {
        if (!options.dryRun)
          await executeOnTarget(`${tr.trigger_def};`).catch(() => {});
        result.schema.triggers++;
      }

      for (const tbl of tablesRes.rows) {
        const tn = tbl.table_name;
        const rlsEnabled = await sourceDb
          .query<{ rowsecurity: boolean }>(
            `SELECT relrowsecurity AS rowsecurity FROM pg_class c
						 JOIN pg_namespace n ON c.relnamespace = n.oid
						 WHERE n.nspname = 'public' AND c.relname = $1`,
            [tn],
          )
          .then((r) => r.rows[0]?.rowsecurity ?? false)
          .catch(() => false);
        if (rlsEnabled && !options.dryRun)
          await executeOnTarget(
            `ALTER TABLE "${tn}" ENABLE ROW LEVEL SECURITY`,
          ).catch(() => {});

        const policiesRes = await sourceDb.query<{
          policyname: string;
          polcmd: string;
          permissive: string;
          roles: string;
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT pol.polname AS policyname,
					   CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS polcmd,
					   CASE pol.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
					   CASE WHEN pol.polroles = '{0}' THEN 'PUBLIC' ELSE (SELECT string_agg(rolname, ', ') FROM pg_roles WHERE oid = ANY(pol.polroles)) END AS roles,
					   pg_get_expr(pol.polqual, pol.polrelid) AS qual,
					   pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
					 FROM pg_policy pol
					 JOIN pg_class c ON pol.polrelid = c.oid
					 JOIN pg_namespace n ON c.relnamespace = n.oid
					 WHERE n.nspname = 'public' AND c.relname = $1`,
          [tn],
        );
        for (const pol of policiesRes.rows) {
          let stmt = `CREATE POLICY "${pol.policyname}" ON "${tn}" AS ${pol.permissive} FOR ${pol.polcmd} TO ${pol.roles}`;
          if (pol.qual) stmt += ` USING (${pol.qual})`;
          if (pol.with_check) stmt += ` WITH CHECK (${pol.with_check})`;
          if (!options.dryRun) await executeOnTarget(stmt).catch(() => {});
          result.schema.policies++;
        }
      }
    }
  }

  if (!options.skipAuth) {
    const usersRes = await sourceDb.query<Record<string, unknown>>(
      `SELECT id, instance_id, aud, role, email, encrypted_password,
			        email_confirmed_at, invited_at, confirmation_token,
			        confirmation_sent_at, recovery_token, recovery_sent_at,
			        email_change_token_new, email_change, email_change_sent_at,
			        email_change_confirm_status, last_sign_in_at,
			        raw_app_meta_data, raw_user_meta_data, is_super_admin,
			        created_at, updated_at, phone, phone_confirmed_at,
			        phone_change, phone_change_token, phone_change_sent_at,
			        banned_until, reauthentication_token, reauthentication_sent_at,
			        is_sso_user, deleted_at, is_anonymous
			 FROM auth.users ORDER BY created_at`,
    );

    for (const u of usersRes.rows) {
      if (!options.dryRun) {
        await executeOnTarget(
          `INSERT INTO auth.users (
					   id, instance_id, aud, role, email, encrypted_password,
					   email_confirmed_at, invited_at, confirmation_token,
					   confirmation_sent_at, recovery_token, recovery_sent_at,
					   email_change_token_new, email_change, email_change_sent_at,
					   email_change_confirm_status, last_sign_in_at,
					   raw_app_meta_data, raw_user_meta_data, is_super_admin,
					   created_at, updated_at, phone, phone_confirmed_at,
					   phone_change, phone_change_token, phone_change_sent_at,
					   banned_until, reauthentication_token, reauthentication_sent_at,
					   is_sso_user, deleted_at, is_anonymous
					 ) VALUES (
					   $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
					 ) ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.instance_id,
            u.aud,
            u.role,
            u.email,
            u.encrypted_password,
            u.email_confirmed_at,
            u.invited_at,
            u.confirmation_token,
            u.confirmation_sent_at,
            u.recovery_token,
            u.recovery_sent_at,
            u.email_change_token_new,
            u.email_change,
            u.email_change_sent_at,
            u.email_change_confirm_status,
            u.last_sign_in_at,
            u.raw_app_meta_data ? JSON.stringify(u.raw_app_meta_data) : "{}",
            u.raw_user_meta_data ? JSON.stringify(u.raw_user_meta_data) : "{}",
            u.is_super_admin,
            u.created_at,
            u.updated_at,
            u.phone,
            u.phone_confirmed_at,
            u.phone_change,
            u.phone_change_token,
            u.phone_change_sent_at,
            u.banned_until,
            u.reauthentication_token,
            u.reauthentication_sent_at,
            u.is_sso_user,
            u.deleted_at,
            u.is_anonymous,
          ],
        );
      }
      result.auth.users++;
    }

    const identitiesRes = await sourceDb.query<Record<string, unknown>>(
      `SELECT id, provider_id, user_id, identity_data, provider,
			        last_sign_in_at, created_at, updated_at
			 FROM auth.identities ORDER BY created_at`,
    );

    for (const ident of identitiesRes.rows) {
      if (!options.dryRun) {
        await executeOnTarget(
          `INSERT INTO auth.identities (
					   id, provider_id, user_id, identity_data, provider,
					   last_sign_in_at, created_at, updated_at
					 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
					 ON CONFLICT (id) DO NOTHING`,
          [
            ident.id,
            ident.provider_id,
            ident.user_id,
            ident.identity_data
              ? JSON.stringify(ident.identity_data)
              : "{}",
            ident.provider,
            ident.last_sign_in_at,
            ident.created_at,
            ident.updated_at,
          ],
        );
      }
      result.auth.identities++;
    }
  }

  if (!options.skipData) {
    const tablesRes = await sourceDb.query<{
      table_name: string;
    }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );

    const fkDeps = await sourceDb.query<{
      child: string;
      parent: string;
    }>(
      `SELECT tc.table_name AS child, ccu.table_name AS parent
			 FROM information_schema.table_constraints tc
			 JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
			 WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY' AND tc.table_name != ccu.table_name`,
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    const deps = new Map<string, Set<string>>();
    for (const t of tableNames) deps.set(t, new Set());
    for (const fk of fkDeps.rows) {
      if (deps.has(fk.child) && deps.has(fk.parent))
        deps.get(fk.child)?.add(fk.parent);
    }
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        sorted.push(name);
        visited.add(name);
        return;
      }
      visiting.add(name);
      for (const dep of deps.get(name) ?? []) visit(dep);
      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };
    for (const t of tableNames) visit(t);

    if (!options.dryRun)
      await executeOnTarget(
        "SET session_replication_role = 'replica'",
      ).catch(() => {});

    for (const tn of sorted) {
      const dataRes = await sourceDb.query(`SELECT * FROM "${tn}"`);
      if (dataRes.rows.length === 0) continue;
      const cols = Object.keys(dataRes.rows[0] as Record<string, unknown>);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const batchSize = 100;
      for (let i = 0; i < dataRes.rows.length; i += batchSize) {
        const batch = dataRes.rows.slice(i, i + batchSize) as Record<
          string,
          unknown
        >[];
        const valueSets: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;
        for (const row of batch) {
          const placeholders = cols.map(() => {
            const ph = `$${paramIdx}`;
            paramIdx++;
            return ph;
          });
          valueSets.push(`(${placeholders.join(", ")})`);
          for (const c of cols) {
            const v = row[c];
            params.push(
              v !== null &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                !(v instanceof Date)
                ? JSON.stringify(v)
                : v,
            );
          }
        }
        if (!options.dryRun) {
          await executeOnTarget(
            `INSERT INTO "${tn}" (${colList}) VALUES ${valueSets.join(", ")} ON CONFLICT DO NOTHING`,
            params,
          );
        }
        result.data.rows += batch.length;
      }
      result.data.tables++;
    }

    if (!options.dryRun)
      await executeOnTarget(
        "SET session_replication_role = 'origin'",
      ).catch(() => {});

    for (const tn of sorted) {
      if (options.dryRun) continue;
      const seqCols = await executeOnTarget(
        `SELECT a.attname, pg_get_serial_sequence($1, a.attname) AS seq
				 FROM pg_attribute a
				 JOIN pg_class c ON a.attrelid = c.oid
				 JOIN pg_namespace n ON c.relnamespace = n.oid
				 WHERE n.nspname = 'public' AND c.relname = $2
				   AND a.attnum > 0 AND NOT a.attisdropped
				   AND pg_get_serial_sequence($1, a.attname) IS NOT NULL`,
        [`"${tn}"`, tn],
      ).catch(
        () =>
          ({
            rows: [],
          }) as QueryResult,
      );
      for (const row of seqCols.rows) {
        const attname = row.attname as string;
        const seq = row.seq as string;
        await executeOnTarget(
          `SELECT setval('${seq}', COALESCE((SELECT MAX("${attname}") FROM "${tn}"), 1), (SELECT MAX("${attname}") FROM "${tn}") IS NOT NULL)`,
        ).catch(() => {});
      }
    }
  }

  if (!options.skipStorage) {
    const bucketsRes = await sourceDb.query<{
      id: string;
      name: string;
      public: boolean;
      file_size_limit: number | null;
      allowed_mime_types: string[] | null;
    }>(
      "SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets",
    );

    for (const bucket of bucketsRes.rows) {
      if (!options.dryRun) {
        await executeOnTarget(
          `INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
					 VALUES($1, $2, $3, $4, $5)
					 ON CONFLICT (id) DO UPDATE SET
					   name = EXCLUDED.name, public = EXCLUDED.public,
					   file_size_limit = EXCLUDED.file_size_limit,
					   allowed_mime_types = EXCLUDED.allowed_mime_types,
					   updated_at = now()`,
          [
            bucket.id,
            bucket.name,
            bucket.public,
            bucket.file_size_limit,
            bucket.allowed_mime_types,
          ],
        );
      }
      result.storage.buckets++;
    }

    if (storageTransfer) {
      const objectsRes = await sourceDb.query<{
        id: string;
        bucket_id: string;
        name: string;
        metadata: Record<string, unknown> | null;
      }>(
        "SELECT id, bucket_id, name, metadata FROM storage.objects ORDER BY bucket_id, name",
      );

      for (const obj of objectsRes.rows) {
        const downloaded = await storageTransfer.download(
          obj.bucket_id,
          obj.name,
        );
        if (!downloaded) continue;
        if (!options.dryRun) {
          const uploaded = await storageTransfer.upload(
            obj.bucket_id,
            obj.name,
            downloaded.data,
            downloaded.contentType,
          );
          if (!uploaded) continue;
        }
        result.storage.objects++;
      }
    }
  }

  return result;
}
