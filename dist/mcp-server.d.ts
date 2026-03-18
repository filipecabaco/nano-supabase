import type { NanoSupabaseInstance } from "./nano.ts";
export interface McpServerConfig {
    httpPort: number;
    serviceRoleKey: string;
    anonKey: string;
}
export interface McpHandler {
    handleRequest: (req: Request) => Promise<Response>;
}
export declare function createMcpHandler(nano: NanoSupabaseInstance, config: McpServerConfig): McpHandler;
//# sourceMappingURL=mcp-server.d.ts.map