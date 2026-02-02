/**
 * Data routes handler - processes /rest/v1/* requests using PostgREST parser
 */

import type { PGlite } from "@electric-sql/pglite";
import type { PostgrestParser } from "../postgrest-parser.ts";
import { setAuthContext } from "./auth-context.ts";
import { errorResponse } from "./error-handler.ts";

/**
 * Create a JSON response
 */
function jsonResponse(
  data: unknown,
  status: number = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice(7);
}

/**
 * Parse request body as JSON
 */
async function parseBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Handle data routes (PostgREST API)
 */
export async function handleDataRoute(
  request: Request,
  pathname: string,
  db: PGlite,
  parser: PostgrestParser,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  // Strip the 'columns' parameter that Supabase JS client adds
  // The parser should derive columns from the body, not from query params
  // Build query string manually to avoid double-encoding
  const params = url.searchParams;
  const filteredParams: string[] = [];
  params.forEach((value, key) => {
    if (key !== "columns") {
      // Don't use encodeURIComponent here - the parser expects unencoded values
      filteredParams.push(`${key}=${value}`);
    }
  });
  const queryString = filteredParams.join("&");

  // Extract table/resource from path: /rest/v1/{table}
  const pathParts = pathname.split("/").filter(Boolean);
  // pathParts: ['rest', 'v1', 'table'] or ['rest', 'v1', 'rpc', 'function_name']
  if (pathParts.length < 3) {
    return jsonResponse({ message: "Invalid path", code: "PGRST000" }, 400);
  }

  const resourcePath = pathParts.slice(2).join("/"); // 'table' or 'rpc/function_name'
  const token = extractBearerToken(request.headers);

  try {
    // Set auth context for RLS
    await setAuthContext(db, token);

    let parsed: { sql: string; params: readonly unknown[] };
    let body: Record<string, unknown> | null = null;

    // Parse body for POST/PATCH/PUT
    if (["POST", "PATCH", "PUT"].includes(method)) {
      body = await parseBody(request);
    }

    switch (method) {
      case "GET":
        parsed = parser.parseRequest("GET", resourcePath, queryString);
        break;
      case "POST":
        parsed = parser.parseRequest(
          "POST",
          resourcePath,
          queryString,
          body || undefined,
        );
        break;
      case "PATCH":
        parsed = parser.parseRequest(
          "PATCH",
          resourcePath,
          queryString,
          body || undefined,
        );
        break;
      case "PUT":
        // PUT is typically used for upsert, treat as POST with conflict handling
        parsed = parser.parseRequest(
          "POST",
          resourcePath,
          queryString,
          body || undefined,
        );
        break;
      case "DELETE":
        parsed = parser.parseRequest("DELETE", resourcePath, queryString);
        break;
      default:
        return jsonResponse(
          { message: "Method not allowed", code: "PGRST105" },
          405,
        );
    }

    /**
     * Workaround: Parser quotes asterisk in RETURNING clause
     * The postgrest_parser incorrectly generates: RETURNING "*"
     * PostgreSQL expects: RETURNING *
     * TODO: Fix in postgrest_parser upstream
     */
    let sql = parsed.sql.replace(/RETURNING "\*"/g, "RETURNING *");

    // Add RETURNING clause if client wants representation and parser didn't add it
    const prefer = request.headers.get("Prefer") || "";
    const returnRepresentation = prefer.includes("return=representation");
    if (
      returnRepresentation &&
      (method === "POST" || method === "PATCH" || method === "DELETE") &&
      !sql.toUpperCase().includes("RETURNING")
    ) {
      sql = `${sql} RETURNING *`;
    }

    // Execute the actual query with parameters
    const result = await db.query(sql, [...parsed.params]);

    // Determine response format based on headers
    const returnMinimal = prefer.includes("return=minimal");
    const countHeader =
      prefer.includes("count=exact") ||
      prefer.includes("count=planned") ||
      prefer.includes("count=estimated");

    // Build response headers
    const responseHeaders: Record<string, string> = {};

    if (countHeader) {
      responseHeaders["Content-Range"] =
        `0-${result.rows.length - 1}/${result.rows.length}`;
    }

    // Handle different operations
    if (method === "GET") {
      return jsonResponse(result.rows, 200, responseHeaders);
    }

    if (method === "POST") {
      if (returnMinimal) {
        return new Response(null, { status: 201, headers: responseHeaders });
      }
      return jsonResponse(result.rows, 201, responseHeaders);
    }

    if (method === "PATCH" || method === "PUT") {
      if (returnMinimal) {
        return new Response(null, { status: 204, headers: responseHeaders });
      }
      if (returnRepresentation) {
        return jsonResponse(result.rows, 200, responseHeaders);
      }
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    if (method === "DELETE") {
      if (returnRepresentation) {
        return jsonResponse(result.rows, 200, responseHeaders);
      }
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    return jsonResponse(result.rows, 200, responseHeaders);
  } catch (err) {
    return errorResponse(err);
  }
}
