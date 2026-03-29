import type { AuthHandler } from "../auth/handler.ts";
import { extractBearerToken, parseBody } from "./index.ts";
import { jsonResponse, notFound, notSupported } from "./response.ts";

const SESSION_CREATION_FAILED = {
  error: "session_creation_failed",
  error_description: "Failed to create session",
} as const;
const MISSING_AUTH = {
  error: "unauthorized",
  error_description: "Missing authorization header",
} as const;

function authErr(error: {
  code?: string;
  message: string;
  status: number;
}): Response {
  return jsonResponse(
    { error: error.code, error_description: error.message },
    error.status,
  );
}

function requireEmail(body: Record<string, unknown>): string | Response {
  const email = typeof body.email === "string" ? body.email : undefined;
  if (!email)
    return jsonResponse(
      { error: "missing_email", error_description: "Email is required" },
      400,
    );
  return email;
}

function requireToken(headers: Headers): string | Response {
  const token = extractBearerToken(headers);
  if (!token) return jsonResponse(MISSING_AUTH, 401);
  return token;
}

export async function handleAuthRoute(
  request: Request,
  pathname: string,
  authHandler: AuthHandler,
  serviceRoleKey?: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const sessionPayload = (
    s: {
      access_token: string;
      token_type: string;
      expires_in: number;
      expires_at: number;
      refresh_token: string;
    },
    user: unknown,
  ) => ({
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user,
  });

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

    if (!email && !password) {
      const anonResult = await authHandler.signInAnonymously();
      if (anonResult.error) return authErr(anonResult.error);
      if (!anonResult.data.session)
        return jsonResponse(SESSION_CREATION_FAILED, 500);
      return jsonResponse(
        sessionPayload(anonResult.data.session, anonResult.data.user),
      );
    }

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
    if (result.error) return authErr(result.error);
    if (!result.data.session) return jsonResponse(SESSION_CREATION_FAILED, 500);
    return jsonResponse(sessionPayload(result.data.session, result.data.user));
  }

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

      if (!result.data.session)
        return jsonResponse(SESSION_CREATION_FAILED, 500);
      return jsonResponse(
        sessionPayload(result.data.session, result.data.user),
      );
    }

    if (grantType === "anonymous") {
      const result = await authHandler.signInAnonymously();
      if (result.error) return authErr(result.error);
      if (!result.data.session)
        return jsonResponse(SESSION_CREATION_FAILED, 500);
      return jsonResponse(
        sessionPayload(result.data.session, result.data.user),
      );
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

      if (!result.data.session)
        return jsonResponse(SESSION_CREATION_FAILED, 500);
      return jsonResponse(
        sessionPayload(result.data.session, result.data.user),
      );
    }

    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description: "Grant type not supported",
      },
      400,
    );
  }

  if (method === "POST" && pathname === "/auth/v1/logout") {
    const token = extractBearerToken(request.headers);
    const result = await authHandler.signOut(token || undefined);
    if (result.error) return authErr(result.error);
    return jsonResponse({});
  }

  if (method === "GET" && pathname === "/auth/v1/user") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const result = await authHandler.getUser(token);
    if (result.error) return authErr(result.error);
    return jsonResponse(result.data.user);
  }

  if (method === "PUT" && pathname === "/auth/v1/user") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;

    const body = await parseBody(request);
    const result = await authHandler.updateUser(token, {
      email: typeof body.email === "string" ? body.email : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      nonce: typeof body.nonce === "string" ? body.nonce : undefined,
      data:
        typeof body.data === "object" &&
        body.data !== null &&
        !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : undefined,
    });

    if (result.error) return authErr(result.error);
    return jsonResponse(result.data.user);
  }

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

  if (method === "POST" && pathname === "/auth/v1/otp") {
    const body = await parseBody(request);
    const email = requireEmail(body);
    if (email instanceof Response) return email;
    const { token } = await authHandler.sendOtp(email);
    return jsonResponse({ token });
  }

  if (method === "POST" && pathname === "/auth/v1/recover") {
    const body = await parseBody(request);
    const email = requireEmail(body);
    if (email instanceof Response) return email;
    const { token } = await authHandler.sendRecovery(email);
    return jsonResponse({ token });
  }

  if (method === "POST" && pathname === "/auth/v1/verify") {
    const body = await parseBody(request);
    const token = typeof body.token === "string" ? body.token : undefined;
    const type = typeof body.type === "string" ? body.type : "magiclink";
    if (!token)
      return jsonResponse(
        { error: "missing_token", error_description: "Token is required" },
        400,
      );
    const result = await authHandler.verifyOtp(token, type);
    if (result.error) return authErr(result.error);
    if (!result.data.session) return jsonResponse(SESSION_CREATION_FAILED, 500);
    return jsonResponse(sessionPayload(result.data.session, result.data.user));
  }

  if (method === "GET" && pathname === "/auth/v1/verify") {
    const token = searchParams.get("token") ?? "";
    const type = searchParams.get("type") ?? "magiclink";
    if (!token)
      return jsonResponse(
        { error: "missing_token", error_description: "Token is required" },
        400,
      );
    const result = await authHandler.verifyOtp(token, type);
    if (result.error) return authErr(result.error);
    if (!result.data.session) return jsonResponse(SESSION_CREATION_FAILED, 500);
    return jsonResponse(sessionPayload(result.data.session, result.data.user));
  }

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

  const requiresServiceRole =
    pathname.startsWith("/auth/v1/admin/") || pathname === "/auth/v1/invite";
  if (requiresServiceRole) {
    const token = extractBearerToken(request.headers);
    if (!serviceRoleKey || token !== serviceRoleKey) {
      return jsonResponse(
        {
          error: "insufficient_permissions",
          error_description: "Service role key required",
        },
        403,
      );
    }
  }

  if (method === "GET" && pathname === "/auth/v1/admin/users") {
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const perPage = parseInt(searchParams.get("per_page") ?? "50", 10);
    const { users, total } = await authHandler.adminListUsers(page, perPage);
    return jsonResponse({ users, aud: "authenticated", total_count: total });
  }

  if (method === "POST" && pathname === "/auth/v1/admin/users") {
    const body = await parseBody(request);
    try {
      const user = await authHandler.adminCreateUser({
        email: typeof body.email === "string" ? body.email : undefined,
        phone: typeof body.phone === "string" ? body.phone : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
        email_confirm:
          typeof body.email_confirm === "boolean"
            ? body.email_confirm
            : undefined,
        user_metadata:
          typeof body.user_metadata === "object" &&
          body.user_metadata !== null &&
          !Array.isArray(body.user_metadata)
            ? (body.user_metadata as Record<string, unknown>)
            : undefined,
        app_metadata:
          typeof body.app_metadata === "object" &&
          body.app_metadata !== null &&
          !Array.isArray(body.app_metadata)
            ? (body.app_metadata as Record<string, unknown>)
            : undefined,
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

  const adminUserMatch = pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
  if (adminUserMatch) {
    const userId = adminUserMatch[1] ?? "";

    if (method === "GET") {
      const user = await authHandler.adminGetUser(userId);
      if (!user) return notFound("User not found");
      return jsonResponse(user);
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await parseBody(request);
      try {
        const user = await authHandler.adminUpdateUser(userId, {
          email: typeof body.email === "string" ? body.email : undefined,
          phone: typeof body.phone === "string" ? body.phone : undefined,
          password:
            typeof body.password === "string" ? body.password : undefined,
          user_metadata:
            typeof body.user_metadata === "object" &&
            body.user_metadata !== null &&
            !Array.isArray(body.user_metadata)
              ? (body.user_metadata as Record<string, unknown>)
              : undefined,
          app_metadata:
            typeof body.app_metadata === "object" &&
            body.app_metadata !== null &&
            !Array.isArray(body.app_metadata)
              ? (body.app_metadata as Record<string, unknown>)
              : undefined,
          ban_duration:
            typeof body.ban_duration === "string"
              ? body.ban_duration
              : undefined,
          email_confirm:
            typeof body.email_confirm === "boolean"
              ? body.email_confirm
              : undefined,
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

  if (method === "GET" && pathname === "/auth/v1/reauthenticate") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const result = await authHandler.reauthenticate(token);
    if (result.error) return authErr(result.error);
    return jsonResponse({});
  }

  if (method === "GET" && pathname === "/auth/v1/authorize") {
    return notSupported("OAuth providers not supported in local mode");
  }

  if (method === "POST" && pathname === "/auth/v1/sso") {
    return notSupported("SSO not supported in local mode");
  }

  if (method === "GET" && pathname === "/auth/v1/.well-known/jwks.json") {
    return jsonResponse({ keys: [] });
  }

  if (method === "POST" && pathname === "/auth/v1/invite") {
    const body = await parseBody(request);
    const email = requireEmail(body);
    if (email instanceof Response) return email;
    const { token } = await authHandler.sendInvite(email);
    return jsonResponse({ token });
  }

  if (method === "POST" && pathname === "/auth/v1/admin/generate_link") {
    const body = await parseBody(request);
    const email = requireEmail(body);
    if (email instanceof Response) return email;
    const type = typeof body.type === "string" ? body.type : "magiclink";
    const { token } = await authHandler.sendOtp(email);
    const actionLink = `http://localhost:54321/auth/v1/verify?token=${token}&type=${type}`;
    return jsonResponse({
      action_link: actionLink,
      email_otp: token,
      hashed_token: token,
    });
  }

  if (method === "POST" && pathname === "/auth/v1/factors") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const body = await parseBody(request);
    const factorType =
      typeof body.factor_type === "string" ? body.factor_type : "totp";
    const friendlyName =
      typeof body.friendly_name === "string" ? body.friendly_name : undefined;
    if (factorType !== "totp")
      return notSupported("Only TOTP factors are supported");
    const result = await authHandler.enrollTOTP(token, friendlyName);
    if (!result)
      return jsonResponse(
        {
          error: "enrollment_failed",
          error_description: "Failed to enroll factor",
        },
        422,
      );
    return jsonResponse(result);
  }

  const factorDeleteMatch = pathname.match(/^\/auth\/v1\/factors\/([^/]+)$/);
  if (factorDeleteMatch && method === "DELETE") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const factorId = factorDeleteMatch[1] ?? "";
    const result = await authHandler.unenrollFactor(token, factorId);
    if (result.error) return authErr(result.error);
    return jsonResponse({});
  }

  const factorChallengeMatch = pathname.match(
    /^\/auth\/v1\/factors\/([^/]+)\/challenge$/,
  );
  if (factorChallengeMatch && method === "POST") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const factorId = factorChallengeMatch[1] ?? "";
    const result = await authHandler.challengeTOTP(token, factorId);
    if (!result)
      return jsonResponse(
        {
          error: "challenge_failed",
          error_description: "Failed to create challenge",
        },
        422,
      );
    return jsonResponse(result);
  }

  const factorVerifyMatch = pathname.match(
    /^\/auth\/v1\/factors\/([^/]+)\/verify$/,
  );
  if (factorVerifyMatch && method === "POST") {
    const token = requireToken(request.headers);
    if (token instanceof Response) return token;
    const factorId = factorVerifyMatch[1] ?? "";
    const body = await parseBody(request);
    const challengeId =
      typeof body.challenge_id === "string" ? body.challenge_id : "";
    const code = typeof body.code === "string" ? body.code : "";
    const result = await authHandler.verifyTOTP(
      token,
      factorId,
      challengeId,
      code,
    );
    if (result.error) return authErr(result.error);
    if (!result.data.session) return jsonResponse(SESSION_CREATION_FAILED, 500);
    return jsonResponse(sessionPayload(result.data.session, result.data.user));
  }

  if (method === "GET" && pathname === "/auth/v1/user/identities/authorize") {
    return notSupported("OAuth not supported in local mode");
  }

  const identityDeleteMatch = pathname.match(
    /^\/auth\/v1\/user\/identities\/([^/]+)$/,
  );
  if (identityDeleteMatch && method === "DELETE") {
    return jsonResponse({});
  }

  if (pathname === "/auth/v1/user/oauth/grants") {
    if (method === "GET") return jsonResponse({ grants: [] });
    if (method === "DELETE") return jsonResponse({});
  }

  const adminUserFactorsMatch = pathname.match(
    /^\/auth\/v1\/admin\/users\/([^/]+)\/factors$/,
  );
  if (adminUserFactorsMatch && method === "GET") {
    const userId = adminUserFactorsMatch[1] ?? "";
    const factors = await authHandler.adminListFactors(userId);
    return jsonResponse({ factors });
  }

  const adminUserFactorDeleteMatch = pathname.match(
    /^\/auth\/v1\/admin\/users\/([^/]+)\/factors\/([^/]+)$/,
  );
  if (adminUserFactorDeleteMatch && method === "DELETE") {
    return jsonResponse({});
  }

  if (pathname === "/auth/v1/admin/oauth/clients") {
    if (method === "GET") return jsonResponse({ clients: [], total: 0 });
    if (method === "POST") return notSupported();
  }
  const adminOauthClientMatch = pathname.match(
    /^\/auth\/v1\/admin\/oauth\/clients\/([^/]+)$/,
  );
  if (adminOauthClientMatch) {
    return notFound();
  }

  if (pathname === "/auth/v1/admin/custom-providers") {
    if (method === "GET") return jsonResponse({ custom_providers: [] });
    if (method === "POST") return notSupported();
  }
  const adminCustomProviderMatch = pathname.match(
    /^\/auth\/v1\/admin\/custom-providers\/([^/]+)$/,
  );
  if (adminCustomProviderMatch) {
    if (method === "DELETE") return jsonResponse({});
    return notFound();
  }

  if (method === "POST" && pathname === "/auth/v1/resend") {
    const body = await parseBody(request);
    const email = requireEmail(body);
    if (email instanceof Response) return email;
    const { token } = await authHandler.sendOtp(email);
    return jsonResponse({ token });
  }

  if (method === "GET" && pathname === "/auth/v1/admin/audit") {
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const perPage = parseInt(searchParams.get("per_page") ?? "50", 10);
    const result = await authHandler.adminAuditLog(page, perPage);
    return jsonResponse(result);
  }

  return notFound("Auth endpoint not found");
}
