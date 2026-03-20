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

export class ServiceClient {
	private url: string;
	private adminToken: string;

	constructor(opts: ServiceClientOptions) {
		this.url = (opts.url ?? "http://localhost:8080").replace(/\/$/, "");
		this.adminToken = opts.adminToken;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.adminToken}`,
			"Content-Type": "application/json",
		};
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const res = await fetch(`${this.url}${path}`, {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		const data = await res.json();
		if (!res.ok) {
			const err = data as { error?: string; message?: string };
			throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
		}
		return data as T;
	}

	async createTenant(
		slug: string,
		opts: CreateTenantOptions = {},
	): Promise<CreateTenantResult> {
		return this.request<CreateTenantResult>("POST", "/admin/tenants", {
			slug,
			token: opts.token,
			password: opts.password,
			anonKey: opts.anonKey,
			serviceRoleKey: opts.serviceRoleKey,
		});
	}

	async listTenants(): Promise<Tenant[]> {
		return this.request<Tenant[]>("GET", "/admin/tenants");
	}

	async getTenant(slug: string): Promise<Tenant> {
		return this.request<Tenant>("GET", `/admin/tenants/${slug}`);
	}

	async deleteTenant(slug: string): Promise<void> {
		await this.request("DELETE", `/admin/tenants/${slug}`);
	}

	async pauseTenant(slug: string): Promise<Tenant> {
		return this.request<Tenant>("POST", `/admin/tenants/${slug}/pause`);
	}

	async wakeTenant(slug: string): Promise<Tenant> {
		return this.request<Tenant>("POST", `/admin/tenants/${slug}/wake`);
	}

	async resetToken(slug: string): Promise<{ token: string }> {
		return this.request<{ token: string }>(
			"POST",
			`/admin/tenants/${slug}/reset-token`,
		);
	}

	async resetPassword(
		slug: string,
		password?: string,
	): Promise<{ password: string }> {
		return this.request<{ password: string }>(
			"POST",
			`/admin/tenants/${slug}/reset-password`,
			password ? { password } : {},
		);
	}

	async sql(
		slug: string,
		query: string,
		params?: unknown[],
	): Promise<SqlResult> {
		return this.request<SqlResult>("POST", `/admin/tenants/${slug}/sql`, {
			sql: query,
			params,
		});
	}
}
