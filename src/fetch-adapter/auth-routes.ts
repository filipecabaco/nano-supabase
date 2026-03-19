/**
 * Auth routes handler - processes /auth/v1/* requests
 */

import type { AuthHandler } from "../auth/handler.ts";
import { jsonResponse, notFound, notSupported } from "./response.ts";

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
async function parseBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const text = await request.text();
		if (!text) return {};
		return JSON.parse(text);
	} catch {
		return {};
	}
}

/**
 * Handle auth routes
 */
export async function handleAuthRoute(
	request: Request,
	pathname: string,
	authHandler: AuthHandler,
	serviceRoleKey?: string,
): Promise<Response> {
	const method = request.method.toUpperCase();
	const url = new URL(request.url);
	const searchParams = url.searchParams;

	// POST /auth/v1/signup
	if (method === "POST" && pathname === "/auth/v1/signup") {
		const body = await parseBody(request);
		const email = typeof body.email === "string" ? body.email : undefined;
		const password =
			typeof body.password === "string" ? body.password : undefined;
		const options =
			body.options != null &&
			typeof body.options === "object" &&
			!Array.isArray(body.options)
				? (body.options as { data?: Record<string, unknown> })
				: undefined;

		if (!email || !password) {
			return jsonResponse(
				{
					error: "email and password are required",
					error_description: "Missing credentials",
				},
				400,
			);
		}

		const result = await authHandler.signUp(email, password, options);

		if (result.error) {
			return jsonResponse(
				{ error: result.error.code, error_description: result.error.message },
				result.error.status,
			);
		}

		if (!result.data.session) {
			return jsonResponse(
				{
					error: "session_creation_failed",
					error_description: "Failed to create session",
				},
				500,
			);
		}

		// Return Supabase auth format (flat structure with token fields)
		return jsonResponse({
			access_token: result.data.session.access_token,
			token_type: result.data.session.token_type,
			expires_in: result.data.session.expires_in,
			expires_at: result.data.session.expires_at,
			refresh_token: result.data.session.refresh_token,
			user: result.data.user,
		});
	}

	// POST /auth/v1/token?grant_type=password (sign in)
	if (method === "POST" && pathname === "/auth/v1/token") {
		const grantType = searchParams.get("grant_type");

		if (grantType === "password") {
			const body = await parseBody(request);
			const email = typeof body.email === "string" ? body.email : undefined;
			const password =
				typeof body.password === "string" ? body.password : undefined;

			if (!email || !password) {
				return jsonResponse(
					{ error: "invalid_grant", error_description: "Missing credentials" },
					400,
				);
			}

			const result = await authHandler.signInWithPassword(email, password);

			if (result.error) {
				return jsonResponse(
					{ error: "invalid_grant", error_description: result.error.message },
					result.error.status,
				);
			}

			if (!result.data.session) {
				return jsonResponse(
					{
						error: "session_creation_failed",
						error_description: "Failed to create session",
					},
					500,
				);
			}

			return jsonResponse({
				access_token: result.data.session.access_token,
				token_type: result.data.session.token_type,
				expires_in: result.data.session.expires_in,
				expires_at: result.data.session.expires_at,
				refresh_token: result.data.session.refresh_token,
				user: result.data.user,
			});
		}

		if (grantType === "refresh_token") {
			const body = await parseBody(request);
			const refreshToken =
				typeof body.refresh_token === "string" ? body.refresh_token : undefined;

			if (!refreshToken) {
				return jsonResponse(
					{
						error: "invalid_grant",
						error_description: "Missing refresh token",
					},
					400,
				);
			}

			const result = await authHandler.refreshSession(refreshToken);

			if (result.error) {
				return jsonResponse(
					{ error: "invalid_grant", error_description: result.error.message },
					result.error.status,
				);
			}

			if (!result.data.session) {
				return jsonResponse(
					{
						error: "session_creation_failed",
						error_description: "Failed to create session",
					},
					500,
				);
			}

			return jsonResponse({
				access_token: result.data.session.access_token,
				token_type: result.data.session.token_type,
				expires_in: result.data.session.expires_in,
				expires_at: result.data.session.expires_at,
				refresh_token: result.data.session.refresh_token,
				user: result.data.user,
			});
		}

		return jsonResponse(
			{
				error: "unsupported_grant_type",
				error_description: "Grant type not supported",
			},
			400,
		);
	}

	// POST /auth/v1/logout
	if (method === "POST" && pathname === "/auth/v1/logout") {
		const token = extractBearerToken(request.headers);
		const result = await authHandler.signOut(token || undefined);

		if (result.error) {
			return jsonResponse(
				{ error: result.error.code, error_description: result.error.message },
				result.error.status,
			);
		}

		return jsonResponse({});
	}

	// GET /auth/v1/user
	if (method === "GET" && pathname === "/auth/v1/user") {
		const token = extractBearerToken(request.headers);

		if (!token) {
			return jsonResponse(
				{
					error: "unauthorized",
					error_description: "Missing authorization header",
				},
				401,
			);
		}

		const result = await authHandler.getUser(token);

		if (result.error) {
			return jsonResponse(
				{ error: result.error.code, error_description: result.error.message },
				result.error.status,
			);
		}

		return jsonResponse(result.data.user);
	}

	// PUT /auth/v1/user
	if (method === "PUT" && pathname === "/auth/v1/user") {
		const token = extractBearerToken(request.headers);

		if (!token) {
			return jsonResponse(
				{
					error: "unauthorized",
					error_description: "Missing authorization header",
				},
				401,
			);
		}

		const body = await parseBody(request);
		const result = await authHandler.updateUser(token, {
			email: body.email as string | undefined,
			password: body.password as string | undefined,
			data: body.data as Record<string, unknown> | undefined,
		});

		if (result.error) {
			return jsonResponse(
				{ error: result.error.code, error_description: result.error.message },
				result.error.status,
			);
		}

		return jsonResponse(result.data.user);
	}

	// GET /auth/v1/session
	if (method === "GET" && pathname === "/auth/v1/session") {
		const token = extractBearerToken(request.headers);
		if (!token) return jsonResponse({ session: null });
		const userResult = await authHandler.getUser(token);
		if (userResult.error || !userResult.data.user)
			return jsonResponse({ session: null });
		return jsonResponse({
			session: {
				access_token: token,
				token_type: "bearer",
				user: userResult.data.user,
			},
		});
	}

	// POST /auth/v1/otp — magic link / OTP (email not sent locally, return success)
	if (method === "POST" && pathname === "/auth/v1/otp") {
		return jsonResponse({});
	}

	// POST /auth/v1/recover — password recovery (email not sent locally, return success)
	if (method === "POST" && pathname === "/auth/v1/recover") {
		return jsonResponse({});
	}

	// POST /auth/v1/verify — verify OTP/token (stub: always fail since no real OTP flow)
	if (method === "POST" && pathname === "/auth/v1/verify") {
		return jsonResponse(
			{
				error: "otp_expired",
				error_description: "Token has expired or is invalid",
			},
			403,
		);
	}

	// GET /auth/v1/settings — return feature flags
	if (method === "GET" && pathname === "/auth/v1/settings") {
		return jsonResponse({
			disable_signup: false,
			mailer_autoconfirm: true,
			phone_autoconfirm: true,
			sms_provider: "",
			mfa_totp_enrollment_status: "disabled",
			mfa_phone_enrollment_status: "disabled",
			saml_enabled: false,
		});
	}

	// ── Admin routes ────────────────────────────────────────────────────

	if (pathname.startsWith("/auth/v1/admin/") && serviceRoleKey) {
		const token = extractBearerToken(request.headers);
		if (token !== serviceRoleKey) {
			return jsonResponse(
				{
					error: "insufficient_permissions",
					error_description: "Service role key required",
				},
				403,
			);
		}
	}

	// GET /auth/v1/admin/users
	if (method === "GET" && pathname === "/auth/v1/admin/users") {
		const page = parseInt(searchParams.get("page") ?? "1", 10);
		const perPage = parseInt(searchParams.get("per_page") ?? "50", 10);
		const { users, total } = await authHandler.adminListUsers(page, perPage);
		return jsonResponse({ users, aud: "authenticated", total_count: total });
	}

	// POST /auth/v1/admin/users — create user
	if (method === "POST" && pathname === "/auth/v1/admin/users") {
		const body = await parseBody(request);
		try {
			const user = await authHandler.adminCreateUser({
				email: body.email as string | undefined,
				phone: body.phone as string | undefined,
				password: body.password as string | undefined,
				email_confirm: body.email_confirm as boolean | undefined,
				user_metadata: body.user_metadata as
					| Record<string, unknown>
					| undefined,
				app_metadata: body.app_metadata as Record<string, unknown> | undefined,
			});
			return jsonResponse(user);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to create user";
			return jsonResponse(
				{ error: "user_creation_failed", error_description: message },
				422,
			);
		}
	}

	// Admin /auth/v1/admin/users/:id
	const adminUserMatch = pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
	if (adminUserMatch) {
		const userId = adminUserMatch[1]!;

		if (method === "GET") {
			const user = await authHandler.adminGetUser(userId);
			if (!user) return notFound("User not found");
			return jsonResponse(user);
		}

		if (method === "PUT" || method === "PATCH") {
			const body = await parseBody(request);
			try {
				const user = await authHandler.adminUpdateUser(userId, {
					email: body.email as string | undefined,
					phone: body.phone as string | undefined,
					password: body.password as string | undefined,
					user_metadata: body.user_metadata as
						| Record<string, unknown>
						| undefined,
					app_metadata: body.app_metadata as
						| Record<string, unknown>
						| undefined,
					ban_duration: body.ban_duration as string | undefined,
					email_confirm: body.email_confirm as boolean | undefined,
				});
				if (!user) return notFound("User not found");
				return jsonResponse(user);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Failed to update user";
				return jsonResponse(
					{ error: "update_failed", error_description: message },
					422,
				);
			}
		}

		if (method === "DELETE") {
			await authHandler.adminDeleteUser(userId);
			return jsonResponse({});
		}
	}

	// GET /auth/v1/reauthenticate
	if (method === "GET" && pathname === "/auth/v1/reauthenticate") {
		return jsonResponse({});
	}

	// GET /auth/v1/authorize — OAuth not supported locally
	if (method === "GET" && pathname === "/auth/v1/authorize") {
		return notSupported("OAuth providers not supported in local mode");
	}

	// POST /auth/v1/sso — SSO not supported locally
	if (method === "POST" && pathname === "/auth/v1/sso") {
		return notSupported("SSO not supported in local mode");
	}

	// GET /auth/v1/.well-known/jwks.json
	if (method === "GET" && pathname === "/auth/v1/.well-known/jwks.json") {
		return jsonResponse({ keys: [] });
	}

	// POST /auth/v1/invite
	if (method === "POST" && pathname === "/auth/v1/invite") {
		return jsonResponse({});
	}

	// POST /auth/v1/admin/generate_link
	if (method === "POST" && pathname === "/auth/v1/admin/generate_link") {
		return jsonResponse({ action_link: "http://localhost/" });
	}

	// POST /auth/v1/factors — MFA not supported locally
	if (method === "POST" && pathname === "/auth/v1/factors") {
		return notSupported("MFA not supported in local mode");
	}

	// DELETE /auth/v1/factors/:factorId
	const factorDeleteMatch = pathname.match(/^\/auth\/v1\/factors\/([^/]+)$/);
	if (factorDeleteMatch && method === "DELETE") {
		return jsonResponse({});
	}

	// POST /auth/v1/factors/:factorId/challenge
	const factorChallengeMatch = pathname.match(
		/^\/auth\/v1\/factors\/([^/]+)\/challenge$/,
	);
	if (factorChallengeMatch && method === "POST") {
		return notSupported("MFA not supported in local mode");
	}

	// POST /auth/v1/factors/:factorId/verify
	const factorVerifyMatch = pathname.match(
		/^\/auth\/v1\/factors\/([^/]+)\/verify$/,
	);
	if (factorVerifyMatch && method === "POST") {
		return notSupported("MFA not supported in local mode");
	}

	// GET /auth/v1/user/identities/authorize — OAuth not supported
	if (method === "GET" && pathname === "/auth/v1/user/identities/authorize") {
		return notSupported("OAuth not supported in local mode");
	}

	// DELETE /auth/v1/user/identities/:id
	const identityDeleteMatch = pathname.match(
		/^\/auth\/v1\/user\/identities\/([^/]+)$/,
	);
	if (identityDeleteMatch && method === "DELETE") {
		return jsonResponse({});
	}

	// GET /auth/v1/user/oauth/grants
	if (method === "GET" && pathname === "/auth/v1/user/oauth/grants") {
		return jsonResponse({ grants: [] });
	}

	// DELETE /auth/v1/user/oauth/grants
	if (method === "DELETE" && pathname === "/auth/v1/user/oauth/grants") {
		return jsonResponse({});
	}

	// GET /auth/v1/admin/users/:id/factors
	const adminUserFactorsMatch = pathname.match(
		/^\/auth\/v1\/admin\/users\/([^/]+)\/factors$/,
	);
	if (adminUserFactorsMatch && method === "GET") {
		return jsonResponse([]);
	}

	// DELETE /auth/v1/admin/users/:id/factors/:factorId
	const adminUserFactorDeleteMatch = pathname.match(
		/^\/auth\/v1\/admin\/users\/([^/]+)\/factors\/([^/]+)$/,
	);
	if (adminUserFactorDeleteMatch && method === "DELETE") {
		return jsonResponse({});
	}

	// Admin OAuth clients
	if (pathname === "/auth/v1/admin/oauth/clients" && method === "GET") {
		return jsonResponse({ clients: [], total: 0 });
	}
	if (pathname === "/auth/v1/admin/oauth/clients" && method === "POST") {
		return notSupported();
	}
	const adminOauthClientMatch = pathname.match(
		/^\/auth\/v1\/admin\/oauth\/clients\/([^/]+)$/,
	);
	if (adminOauthClientMatch) {
		if (method === "GET") return notFound();
		if (method === "PUT") return notFound();
		if (method === "DELETE") return notFound();
	}

	// Admin custom providers
	if (pathname === "/auth/v1/admin/custom-providers" && method === "GET") {
		return jsonResponse({ custom_providers: [] });
	}
	if (pathname === "/auth/v1/admin/custom-providers" && method === "POST") {
		return notSupported();
	}
	const adminCustomProviderMatch = pathname.match(
		/^\/auth\/v1\/admin\/custom-providers\/([^/]+)$/,
	);
	if (adminCustomProviderMatch) {
		if (method === "GET") return notFound();
		if (method === "PUT") return notFound();
		if (method === "DELETE") return jsonResponse({});
	}

	// Not found
	return notFound("Auth endpoint not found");
}
