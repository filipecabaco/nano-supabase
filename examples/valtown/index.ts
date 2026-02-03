import { initDb, saveSnapshot } from "./persistence.ts";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: HEADERS });
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

async function getFlag(supabase: any, name: string) {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("*")
    .eq("name", name)
    .single();

  if (error || !data) return null;
  return data;
}

async function handleListFlags(supabase: any, url: URL) {
  let query = supabase
    .from("feature_flags")
    .select("*")
    .order("created_at", { ascending: false });

  const enabled = url.searchParams.get("enabled");
  if (enabled !== null) {
    query = query.is("enabled", enabled === "true");
  }

  const app = url.searchParams.get("app");
  if (app) {
    const { data: appFlags } = await supabase
      .from("flag_apps")
      .select("*")
      .eq("app_name", app);

    if (appFlags?.length) {
      query = query.in("id", appFlags.map((f: any) => f.flag_id));
    }
  }

  const environment = url.searchParams.get("environment");
  if (environment) {
    const { data: envFlags } = await supabase
      .from("flag_environments")
      .select("*")
      .eq("environment", environment);

    if (envFlags?.length) {
      query = query.in("id", envFlags.map((f: any) => f.flag_id));
    }
  }

  const { data, error } = await query;
  return json({ data, error: error?.message });
}

async function handleCreateFlag(supabase: any, req: Request) {
  const body = await req.json();
  const { error } = await supabase
    .from("feature_flags")
    .insert({
      name: body.name,
      description: body.description ?? "",
      enabled: body.enabled ?? false,
      rollout_percentage: body.rollout_percentage ?? 100,
    });

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();

  const created = await getFlag(supabase, body.name);
  return json({ data: created }, 201);
}

async function handleGetFlag(supabase: any, name: string) {
  const flag = await getFlag(supabase, name);
  if (!flag) return json({ error: "Flag not found" }, 404);

  const { data: environments } = await supabase
    .from("flag_environments")
    .select("*")
    .eq("flag_id", flag.id);

  const { data: apps } = await supabase
    .from("flag_apps")
    .select("*")
    .eq("flag_id", flag.id);

  return json({ data: { ...flag, environments: environments ?? [], apps: apps ?? [] } });
}

async function handleUpdateFlag(supabase: any, name: string, req: Request) {
  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.description !== undefined) updates.description = body.description;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.rollout_percentage !== undefined) updates.rollout_percentage = body.rollout_percentage;

  const { error } = await supabase
    .from("feature_flags")
    .update(updates)
    .eq("name", name);

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();

  const updated = await getFlag(supabase, name);
  return json({ data: updated });
}

async function handleDeleteFlag(supabase: any, name: string) {
  const flag = await getFlag(supabase, name);
  if (!flag) return json({ error: "Flag not found" }, 404);

  const { error } = await supabase
    .from("feature_flags")
    .delete()
    .eq("name", name);

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();
  return json({ data: { deleted: true } });
}

async function handleToggleFlag(supabase: any, name: string) {
  const flag = await getFlag(supabase, name);
  if (!flag) return json({ error: "Flag not found" }, 404);

  const { error } = await supabase
    .from("feature_flags")
    .update({ enabled: !flag.enabled, updated_at: new Date().toISOString() })
    .eq("name", name);

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();

  const toggled = await getFlag(supabase, name);
  return json({ data: toggled });
}

async function handleEvaluateFlag(supabase: any, name: string, url: URL) {
  const app = url.searchParams.get("app");
  const environment = url.searchParams.get("environment");
  if (!app || !environment) {
    return json({ error: "app and environment query params required" }, 400);
  }

  const flag = await getFlag(supabase, name);
  if (!flag) return json({ data: { flag_name: name, active: false, reason: "flag_not_found" } });

  const { data: scopedApps } = await supabase
    .from("flag_apps")
    .select("*")
    .eq("flag_id", flag.id);

  if (scopedApps?.length) {
    const isScoped = scopedApps.some((a: any) => a.app_name === app);
    if (!isScoped) {
      return json({ data: { flag_name: name, active: false, reason: "app_not_scoped" } });
    }
  }

  let enabled = flag.enabled;

  const { data: envOverride } = await supabase
    .from("flag_environments")
    .select("*")
    .eq("flag_id", flag.id)
    .eq("environment", environment)
    .maybeSingle();

  if (envOverride) {
    enabled = envOverride.enabled;
  }

  if (!enabled) {
    return json({ data: { flag_name: name, active: false, reason: "disabled" } });
  }

  if (flag.rollout_percentage < 100) {
    const identifier = url.searchParams.get("identifier");
    const roll = identifier ? hashString(identifier) : Math.floor(Math.random() * 100);
    if (roll >= flag.rollout_percentage) {
      return json({ data: { flag_name: name, active: false, reason: "rollout_excluded" } });
    }
  }

  return json({ data: { flag_name: name, active: true } });
}

async function handleAddEnvironment(supabase: any, name: string, req: Request) {
  const flag = await getFlag(supabase, name);
  if (!flag) return json({ error: "Flag not found" }, 404);

  const body = await req.json();
  const { error } = await supabase
    .from("flag_environments")
    .insert({ flag_id: flag.id, environment: body.environment, enabled: body.enabled ?? false });

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();

  const { data: created } = await supabase
    .from("flag_environments")
    .select("*")
    .eq("flag_id", flag.id)
    .eq("environment", body.environment)
    .single();

  return json({ data: created }, 201);
}

async function handleAddApp(supabase: any, name: string, req: Request) {
  const flag = await getFlag(supabase, name);
  if (!flag) return json({ error: "Flag not found" }, 404);

  const body = await req.json();
  const { error } = await supabase
    .from("flag_apps")
    .insert({ flag_id: flag.id, app_name: body.app_name });

  if (error) return json({ error: error.message }, 400);
  await saveSnapshot();

  const { data: created } = await supabase
    .from("flag_apps")
    .select("*")
    .eq("flag_id", flag.id)
    .eq("app_name", body.app_name)
    .single();

  return json({ data: created }, 201);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: HEADERS });
  }

  try {
    const { supabase } = await initDb();
    const url = new URL(req.url);
    const segments = parseSegments(url.pathname);

    if (segments.length === 0) {
      return json({
        message: "nano-supabase Feature Flag Service",
        github: "https://github.com/filipecabaco/nano-supabase",
        endpoints: [
          "GET    /flags                              List flags (?enabled, ?app, ?environment)",
          "POST   /flags                              Create flag { name, description?, enabled?, rollout_percentage? }",
          "GET    /flags/:name                        Get flag details",
          "PATCH  /flags/:name                        Update flag { description?, enabled?, rollout_percentage? }",
          "DELETE /flags/:name                        Delete flag",
          "POST   /flags/:name/toggle                 Toggle flag on/off",
          "GET    /flags/:name/evaluate               Evaluate flag ?app=x&environment=y&identifier=z",
          "POST   /flags/:name/environments           Add env override { environment, enabled }",
          "POST   /flags/:name/apps                   Add app scope { app_name }",
        ],
      });
    }

    if (segments[0] !== "flags") {
      return json({ error: "Not found" }, 404);
    }

    if (segments.length === 1) {
      if (req.method === "GET") return handleListFlags(supabase, url);
      if (req.method === "POST") return handleCreateFlag(supabase, req);
      return json({ error: "Method not allowed" }, 405);
    }

    const flagName = decodeURIComponent(segments[1]);
    const action = segments[2];

    if (!action) {
      if (req.method === "GET") return handleGetFlag(supabase, flagName);
      if (req.method === "PATCH") return handleUpdateFlag(supabase, flagName, req);
      if (req.method === "DELETE") return handleDeleteFlag(supabase, flagName);
      return json({ error: "Method not allowed" }, 405);
    }

    if (action === "toggle" && req.method === "POST") return handleToggleFlag(supabase, flagName);
    if (action === "evaluate" && req.method === "GET") return handleEvaluateFlag(supabase, flagName, url);
    if (action === "environments" && req.method === "POST") return handleAddEnvironment(supabase, flagName, req);
    if (action === "apps" && req.method === "POST") return handleAddApp(supabase, flagName, req);

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
