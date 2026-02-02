/**
 * Auth routes handler - processes /auth/v1/* requests
 */
import type { AuthHandler } from '../auth/handler.ts';
/**
 * Handle auth routes
 */
export declare function handleAuthRoute(request: Request, pathname: string, authHandler: AuthHandler): Promise<Response>;
//# sourceMappingURL=auth-routes.d.ts.map