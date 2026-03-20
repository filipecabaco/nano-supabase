export interface TenantUsage {
    requests: number;
    errors: number;
    avgLatencyMs: number;
    lastLatencyMs: number;
    bytesIn: number;
    bytesOut: number;
}
export interface Tenant {
    id: string;
    slug: string;
    state: "running" | "sleeping" | "waking" | "pausing";
    lastActive: string;
    tcpPort: number;
    pgUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    usage: TenantUsage;
}
export interface CreateTenantOptions {
    token?: string;
    password?: string;
    anonKey?: string;
    serviceRoleKey?: string;
}
export interface CreateTenantResult {
    token: string;
    password: string;
    tenant: Tenant;
}
export interface SqlResult {
    rows: Record<string, unknown>[];
    rowCount: number;
}
export interface ServiceClientOptions {
    url?: string;
    adminToken: string;
}
export declare class ServiceClient {
    private url;
    private adminToken;
    constructor(opts: ServiceClientOptions);
    private headers;
    private request;
    createTenant(slug: string, opts?: CreateTenantOptions): Promise<CreateTenantResult>;
    listTenants(): Promise<Tenant[]>;
    getTenant(slug: string): Promise<Tenant>;
    deleteTenant(slug: string): Promise<void>;
    pauseTenant(slug: string): Promise<Tenant>;
    wakeTenant(slug: string): Promise<Tenant>;
    resetToken(slug: string): Promise<{
        token: string;
    }>;
    resetPassword(slug: string, password?: string): Promise<{
        password: string;
    }>;
    sql(slug: string, query: string, params?: unknown[]): Promise<SqlResult>;
}
//# sourceMappingURL=service-client.d.ts.map