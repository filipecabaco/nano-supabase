export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse(
    { statusCode: status.toString(), error: message, message },
    status,
  );
}

export function notSupported(description?: string): Response {
  return jsonResponse(
    {
      error: "not_supported",
      error_description: description ?? "Not supported in local mode",
    },
    400,
  );
}

export function notFound(description?: string): Response {
  return jsonResponse(
    { error: "not_found", error_description: description ?? "Not found" },
    404,
  );
}
