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
export declare function extractPostgresError(err: unknown): ApiError;
export declare function postgresErrorResponse(err: unknown, status?: number): Response;
//# sourceMappingURL=error-handler.d.ts.map