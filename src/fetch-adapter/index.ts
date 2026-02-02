/**
 * Scoped Fetch Adapter
 *
 * Creates a custom fetch function that intercepts Supabase API calls:
 * - /auth/v1/* -> Local auth handler
 * - /rest/v1/* -> Local PostgREST parser + PGlite
 * - Everything else -> Passthrough to original fetch
 *
 * This allows using the standard @supabase/supabase-js client with local emulation
 * while still being able to interact with other APIs and Supabase products
 * (Storage, Realtime, Edge Functions, etc.)
 */

import type { PGlite } from "@electric-sql/pglite";
import type { PostgrestParser } from "../postgrest-parser.ts";
import type { AuthHandler } from "../auth/handler.ts";
import { handleAuthRoute } from "./auth-routes.ts";
import { handleDataRoute } from "./data-routes.ts";

export interface FetchAdapterConfig {
  /** The PGlite database instance */
  db: PGlite;
  /** The PostgREST parser instance */
  parser: PostgrestParser;
  /** The auth handler instance */
  authHandler: AuthHandler;
  /** The Supabase URL to intercept (used to match requests) */
  supabaseUrl: string;
  /**
   * Original fetch function to use for passthrough requests
   * Defaults to globalThis.fetch
   */
  originalFetch?: typeof fetch;
  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Route information extracted from a request
 */
interface RouteInfo {
  /** Whether this request should be intercepted */
  intercept: boolean;
  /** The route type (auth, data, or passthrough) */
  type: "auth" | "data" | "passthrough";
  /** The pathname for intercepted routes */
  pathname?: string;
}

/**
 * Determine if and how a request should be routed
 */
function getRouteInfo(request: Request, supabaseUrl: string): RouteInfo {
  const url = new URL(request.url);
  const supabaseHost = new URL(supabaseUrl).host;

  // Only intercept requests to the configured Supabase URL
  if (url.host !== supabaseHost) {
    return { intercept: false, type: "passthrough" };
  }

  const pathname = url.pathname;

  // Auth routes: /auth/v1/*
  if (pathname.startsWith("/auth/v1/")) {
    return { intercept: true, type: "auth", pathname };
  }

  // Data routes: /rest/v1/*
  if (pathname.startsWith("/rest/v1/")) {
    return { intercept: true, type: "data", pathname };
  }

  // All other routes pass through (storage, realtime, edge functions, etc.)
  return { intercept: false, type: "passthrough" };
}

/**
 * Create a scoped fetch adapter that intercepts Supabase requests
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js'
 * import { createLocalFetch } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const { fetch: localFetch, authHandler } = await createLocalFetch({
 *   db,
 *   parser,
 *   authHandler,
 *   supabaseUrl: 'http://localhost:54321',
 * })
 *
 * const supabase = createClient('http://localhost:54321', 'your-anon-key', {
 *   global: { fetch: localFetch }
 * })
 *
 * // Now auth and data calls are handled locally
 * await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
 * await supabase.from('users').select('*')
 *
 * // Other calls (storage, realtime, etc.) pass through to the network
 * await supabase.storage.from('avatars').upload('avatar.png', file)
 * ```
 */
export function createLocalFetch(config: FetchAdapterConfig): typeof fetch {
  const {
    db,
    parser,
    authHandler,
    supabaseUrl,
    originalFetch = globalThis.fetch.bind(globalThis),
    debug = false,
  } = config;

  const log = debug
    ? (...args: unknown[]) => console.log("[nano-supabase]", ...args)
    : () => {};

  return async function localFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Normalize input to Request object
    const request = input instanceof Request ? input : new Request(input, init);

    const routeInfo = getRouteInfo(request, supabaseUrl);

    if (!routeInfo.intercept) {
      log("Passthrough:", request.method, request.url);
      // Pass through to original fetch
      return originalFetch(input, init);
    }

    // Log all headers for debugging
    const authHeader = request.headers.get("Authorization");
    console.log("🌐 [FETCH_ADAPTER] Intercepting:", {
      type: routeInfo.type,
      method: request.method,
      pathname: routeInfo.pathname,
      hasAuth: !!authHeader,
      authPreview: authHeader ? `${authHeader.slice(0, 30)}...` : "none",
    });
    log("Intercepting:", routeInfo.type, request.method, routeInfo.pathname);
    log(
      "Authorization header:",
      authHeader ? `${authHeader.slice(0, 20)}...` : "none",
    );

    try {
      let response: Response;

      if (routeInfo.type === "auth" && routeInfo.pathname) {
        response = await handleAuthRoute(
          request,
          routeInfo.pathname,
          authHandler,
        );
      } else if (routeInfo.type === "data" && routeInfo.pathname) {
        response = await handleDataRoute(
          request,
          routeInfo.pathname,
          db,
          parser,
        );
      } else {
        // Should not reach here, but pass through just in case
        return originalFetch(input, init);
      }

      // Log response status
      log("Response status:", response.status);

      return response;
    } catch (err) {
      log("Error handling request:", err);

      // Return error response
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

export { handleAuthRoute } from "./auth-routes.ts";
export { handleDataRoute } from "./data-routes.ts";
