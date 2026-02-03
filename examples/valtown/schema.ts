import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";

export async function createSchema(db: PGlite) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      enabled BOOLEAN DEFAULT false,
      rollout_percentage INTEGER DEFAULT 100
        CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS flag_environments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
      environment TEXT NOT NULL,
      enabled BOOLEAN DEFAULT false,
      UNIQUE(flag_id, environment)
    );

    CREATE TABLE IF NOT EXISTS flag_apps (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
      app_name TEXT NOT NULL,
      UNIQUE(flag_id, app_name)
    );

    CREATE INDEX IF NOT EXISTS idx_flag_environments_flag_id ON flag_environments(flag_id);
    CREATE INDEX IF NOT EXISTS idx_flag_apps_flag_id ON flag_apps(flag_id);
    CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(name);
  `);
}
