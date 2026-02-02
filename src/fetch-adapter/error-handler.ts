/**
 * Error handling utilities for API routes
 */

export interface PostgresError extends Error {
  detail?: string;
  hint?: string;
  code?: string;
}

export interface ApiError {
  message: string;
  code: string;
  details?: string;
  hint?: string;
}

/**
 * Extract PostgreSQL error details
 */
export function extractPostgresError(err: unknown): ApiError {
  if (!(err instanceof Error)) {
    return {
      message: "Unknown error occurred",
      code: "PGRST000",
    };
  }

  const pgError = err as PostgresError;
  return {
    message: err.message,
    code: pgError.code || "PGRST000",
    details: pgError.detail,
    hint: pgError.hint,
  };
}

/**
 * Create JSON error response
 */
export function errorResponse(err: unknown, status: number = 400): Response {
  const apiError = extractPostgresError(err);
  return new Response(JSON.stringify(apiError), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
