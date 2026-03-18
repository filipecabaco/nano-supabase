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
export declare function extractPostgresError(err: unknown): ApiError;
/**
 * Create JSON error response
 */
export declare function errorResponse(err: unknown, status?: number): Response;
//# sourceMappingURL=error-handler.d.ts.map