import type { PGliteInterface } from "@electric-sql/pglite";
import type { AuthHandler } from "../auth/handler.ts";
import type { PostgrestParser } from "../postgrest-parser.ts";
import type { StorageHandler } from "../storage/handler.ts";
import { handleAuthRoute } from "./auth-routes.ts";
import { handleDataRoute } from "./data-routes.ts";
import { handleStorageRoute, type TusSessionMap } from "./storage-routes.ts";

export interface FetchAdapterConfig {
  db: PGliteInterface;
  parser: PostgrestParser;
  authHandler: AuthHandler;
  storageHandler?: StorageHandler;
  supabaseUrl: string;
  originalFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  debug?: boolean;
  serviceRoleKey?: string;
}

type RouteInfo =
  | { intercept: true; type: "auth" | "data" | "storage"; pathname: string }
  | { intercept: false; type: "passthrough" };

function getRouteInfo(
  request: Request,
  supabaseUrl: string,
  hasStorage: boolean,
): RouteInfo {
  const url = new URL(request.url);
  const supabaseHost = new URL(supabaseUrl).host;

  if (url.host !== supabaseHost) {
    return { intercept: false, type: "passthrough" };
  }

  const pathname = url.pathname;

  if (pathname.startsWith("/auth/v1/")) {
    return { intercept: true, type: "auth", pathname };
  }

  if (pathname.startsWith("/rest/v1/")) {
    return { intercept: true, type: "data", pathname };
  }

  if (hasStorage && pathname.startsWith("/storage/v1/")) {
    return { intercept: true, type: "storage", pathname };
  }

  return { intercept: false, type: "passthrough" };
}

export function createLocalFetch(
  config: FetchAdapterConfig,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const {
    db,
    parser,
    authHandler,
    storageHandler,
    supabaseUrl,
    originalFetch = globalThis.fetch.bind(globalThis),
    debug = false,
    serviceRoleKey,
  } = config;

  const log = debug
    ? (...args: unknown[]) => console.log("[nano-supabase]", ...args)
    : () => {};

  const tusSessions: TusSessionMap = new Map();

  return async function localFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);

    const routeInfo = getRouteInfo(request, supabaseUrl, !!storageHandler);

    if (!routeInfo.intercept) {
      log("Passthrough:", request.method, request.url);
      return originalFetch(input, init);
    }

    log("Intercepting:", routeInfo.type, request.method, routeInfo.pathname);

    try {
      let response: Response;

      if (routeInfo.type === "auth") {
        response = await handleAuthRoute(
          request,
          routeInfo.pathname,
          authHandler,
          serviceRoleKey,
        );
      } else if (routeInfo.type === "data") {
        response = await handleDataRoute(
          request,
          routeInfo.pathname,
          db,
          parser,
        );
      } else if (storageHandler) {
        response = await handleStorageRoute(
          request,
          routeInfo.pathname,
          db,
          storageHandler,
          tusSessions,
        );
      } else {
        return originalFetch(input, init);
      }

      log("Response:", response.status);

      return response;
    } catch (err) {
      log("Error:", err);
      const message = err instanceof Error ? err.message : "Internal error";
      return new Response(
        JSON.stringify({ error: "internal_error", error_description: message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

export function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice(7);
}

export async function parseBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export { handleAuthRoute } from "./auth-routes.ts";
export { handleDataRoute } from "./data-routes.ts";
export { handleStorageRoute } from "./storage-routes.ts";
