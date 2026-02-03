import { PGlite } from "@electric-sql/pglite";
import { createSupabaseClient } from "../../dist/index.js";

const PORT = 3456;

const db = new PGlite();

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

const supabase = await createSupabaseClient(db);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function parseSegments(path: string) {
  return path.split("/").filter(Boolean);
}

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

// deno-lint-ignore no-explicit-any
async function getFlag(name: string): Promise<any> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("*")
    .eq("name", name)
    .single();

  if (error || !data) return null;
  return data;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return json(null, 204);

  try {
    const url = new URL(req.url);
    const segments = parseSegments(url.pathname);
    // deno-lint-ignore no-explicit-any
    let body: any;
    if (["POST", "PATCH", "PUT"].includes(req.method)) {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    }

    if (segments.length === 0) {
      return json({
        message: "nano-supabase Feature Flag Service (local)",
        endpoints: [
          "GET    /flags",
          "POST   /flags",
          "GET    /flags/:name",
          "PATCH  /flags/:name",
          "DELETE /flags/:name",
          "POST   /flags/:name/toggle",
          "GET    /flags/:name/evaluate?app=x&environment=y&identifier=z",
          "POST   /flags/:name/environments",
          "POST   /flags/:name/apps",
        ],
      });
    }

    if (segments[0] !== "flags") return json({ error: "Not found" }, 404);

    if (segments.length === 1) {
      if (req.method === "GET") {
        let query = supabase.from("feature_flags").select("*").order("created_at", { ascending: false });
        const enabled = url.searchParams.get("enabled");
        if (enabled !== null) query = query.is("enabled", enabled === "true");

        const app = url.searchParams.get("app");
        if (app) {
          const { data: appFlags } = await supabase.from("flag_apps").select("*").eq("app_name", app);
          // deno-lint-ignore no-explicit-any
          if (appFlags?.length) query = query.in("id", (appFlags as any[]).map((f) => f.flag_id));
        }

        const environment = url.searchParams.get("environment");
        if (environment) {
          const { data: envFlags } = await supabase.from("flag_environments").select("*").eq("environment", environment);
          // deno-lint-ignore no-explicit-any
          if (envFlags?.length) query = query.in("id", (envFlags as any[]).map((f) => f.flag_id));
        }

        const { data, error } = await query;
        return json({ data, error: error?.message });
      }

      if (req.method === "POST") {
        const { error } = await supabase.from("feature_flags").insert({
          name: body.name,
          description: body.description ?? "",
          enabled: body.enabled ?? false,
          rollout_percentage: body.rollout_percentage ?? 100,
        });
        if (error) return json({ error: error.message }, 400);
        const created = await getFlag(body.name);
        return json({ data: created }, 201);
      }

      return json({ error: "Method not allowed" }, 405);
    }

    const flagName = decodeURIComponent(segments[1]);
    const action = segments[2];

    if (!action) {
      if (req.method === "GET") {
        const flag = await getFlag(flagName);
        if (!flag) return json({ error: "Flag not found" }, 404);
        const { data: environments } = await supabase.from("flag_environments").select("*").eq("flag_id", flag.id);
        const { data: apps } = await supabase.from("flag_apps").select("*").eq("flag_id", flag.id);
        return json({ data: { ...flag, environments: environments ?? [], apps: apps ?? [] } });
      }

      if (req.method === "PATCH") {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.description !== undefined) updates.description = body.description;
        if (body.enabled !== undefined) updates.enabled = body.enabled;
        if (body.rollout_percentage !== undefined) updates.rollout_percentage = body.rollout_percentage;
        const { error } = await supabase.from("feature_flags").update(updates).eq("name", flagName);
        if (error) return json({ error: error.message }, 400);
        const updated = await getFlag(flagName);
        return json({ data: updated });
      }

      if (req.method === "DELETE") {
        const flag = await getFlag(flagName);
        if (!flag) return json({ error: "Flag not found" }, 404);
        const { error } = await supabase.from("feature_flags").delete().eq("name", flagName);
        if (error) return json({ error: error.message }, 400);
        return json({ data: { deleted: true } });
      }

      return json({ error: "Method not allowed" }, 405);
    }

    if (action === "toggle" && req.method === "POST") {
      const flag = await getFlag(flagName);
      if (!flag) return json({ error: "Flag not found" }, 404);
      const { error } = await supabase.from("feature_flags").update({ enabled: !flag.enabled, updated_at: new Date().toISOString() }).eq("name", flagName);
      if (error) return json({ error: error.message }, 400);
      const toggled = await getFlag(flagName);
      return json({ data: toggled });
    }

    if (action === "evaluate" && req.method === "GET") {
      const app = url.searchParams.get("app");
      const environment = url.searchParams.get("environment");
      if (!app || !environment) return json({ error: "app and environment query params required" }, 400);

      const flag = await getFlag(flagName);
      if (!flag) return json({ data: { flag_name: flagName, active: false, reason: "flag_not_found" } });

      const { data: scopedApps } = await supabase.from("flag_apps").select("*").eq("flag_id", flag.id);
      if (scopedApps?.length) {
        // deno-lint-ignore no-explicit-any
        const isScoped = (scopedApps as any[]).some((a) => a.app_name === app);
        if (!isScoped) return json({ data: { flag_name: flagName, active: false, reason: "app_not_scoped" } });
      }

      let enabled = flag.enabled;
      const { data: envOverride } = await supabase.from("flag_environments").select("*").eq("flag_id", flag.id).eq("environment", environment).maybeSingle();
      // deno-lint-ignore no-explicit-any
      if (envOverride) enabled = (envOverride as any).enabled;

      if (!enabled) return json({ data: { flag_name: flagName, active: false, reason: "disabled" } });

      if (flag.rollout_percentage < 100) {
        const identifier = url.searchParams.get("identifier");
        const roll = identifier ? hashString(identifier) : Math.floor(Math.random() * 100);
        if (roll >= flag.rollout_percentage) return json({ data: { flag_name: flagName, active: false, reason: "rollout_excluded" } });
      }

      return json({ data: { flag_name: flagName, active: true } });
    }

    if (action === "environments" && req.method === "POST") {
      const flag = await getFlag(flagName);
      if (!flag) return json({ error: "Flag not found" }, 404);
      const { error } = await supabase.from("flag_environments").insert({ flag_id: flag.id, environment: body.environment, enabled: body.enabled ?? false });
      if (error) return json({ error: error.message }, 400);
      const { data: created } = await supabase.from("flag_environments").select("*").eq("flag_id", flag.id).eq("environment", body.environment).single();
      return json({ data: created }, 201);
    }

    if (action === "apps" && req.method === "POST") {
      const flag = await getFlag(flagName);
      if (!flag) return json({ error: "Flag not found" }, 404);
      const { error } = await supabase.from("flag_apps").insert({ flag_id: flag.id, app_name: body.app_name });
      if (error) return json({ error: error.message }, 400);
      const { data: created } = await supabase.from("flag_apps").select("*").eq("flag_id", flag.id).eq("app_name", body.app_name).single();
      return json({ data: created }, 201);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

Deno.serve({ port: PORT }, handler);
