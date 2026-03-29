import type { PGliteInterface } from "@electric-sql/pglite";
import type { PostgrestParser } from "../postgrest-parser.ts";
import { setAuthContext } from "./auth-context.ts";
import { postgresErrorResponse } from "./error-handler.ts";
import { extractBearerToken, parseBody } from "./index.ts";
import { jsonResponse } from "./response.ts";

export async function handleDataRoute(
  request: Request,
  pathname: string,
  db: PGliteInterface,
  parser: PostgrestParser,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  const params = url.searchParams;
  const filteredParams: string[] = [];
  params.forEach((value, key) => {
    if (key !== "columns") {
      filteredParams.push(`${key}=${value}`);
    }
  });
  const queryString = filteredParams.join("&");

  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.length < 3) {
    return jsonResponse({ message: "Invalid path", code: "PGRST000" }, 400);
  }

  const resourcePath = pathParts.slice(2).join("/");
  const token = extractBearerToken(request.headers);

  try {
    await setAuthContext(db, token);

    let body: Record<string, unknown> | null = null;
    if (["POST", "PATCH", "PUT"].includes(method)) {
      body = await parseBody(request);
    }

    const parserMethod =
      method === "HEAD" ? "GET" : method === "PUT" ? "POST" : method;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(parserMethod)) {
      return jsonResponse(
        { message: "Method not allowed", code: "PGRST105" },
        405,
      );
    }
    const hasBody = ["POST", "PATCH", "PUT"].includes(method);
    const parsed = parser.parseRequest(
      parserMethod as "GET" | "POST" | "PATCH" | "DELETE",
      resourcePath,
      queryString,
      hasBody ? body || undefined : undefined,
    );

    let sql = parsed.sql.replace(/RETURNING "\*"/g, "RETURNING *");

    const prefer = request.headers.get("Prefer") || "";
    const returnRepresentation = prefer.includes("return=representation");
    if (
      returnRepresentation &&
      (method === "POST" || method === "PATCH" || method === "DELETE") &&
      !sql.toUpperCase().includes("RETURNING")
    ) {
      sql = `${sql} RETURNING *`;
    }

    const result = await db.query(sql, [...parsed.params]);

    const returnMinimal = prefer.includes("return=minimal");
    const countHeader =
      prefer.includes("count=exact") ||
      prefer.includes("count=planned") ||
      prefer.includes("count=estimated");

    const responseHeaders: Record<string, string> = {};

    if (countHeader) {
      responseHeaders["Content-Range"] =
        `0-${result.rows.length - 1}/${result.rows.length}`;
    }

    if (method === "HEAD") {
      responseHeaders["Content-Range"] =
        `0-${result.rows.length - 1}/${result.rows.length}`;
      return new Response(null, { status: 200, headers: responseHeaders });
    }
    if (method === "GET")
      return jsonResponse(result.rows, 200, responseHeaders);
    if (method === "POST" && !returnMinimal)
      return jsonResponse(result.rows, 201, responseHeaders);
    if (returnRepresentation)
      return jsonResponse(result.rows, 200, responseHeaders);
    return new Response(null, {
      status: method === "POST" ? 201 : 204,
      headers: responseHeaders,
    });
  } catch (err) {
    return postgresErrorResponse(err);
  }
}
