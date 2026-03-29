import type { PGliteInterface } from "@electric-sql/pglite";
import { decodeJWT, type JWTPayload, signJWT, verifyJWT } from "./jwt.ts";
import type { TokenPair, User } from "./types.ts";

const DEFAULT_ACCESS_TOKEN_EXPIRY = 3600;

const secretCache = new WeakMap<PGliteInterface, string>();

async function getJWTSecret(db: PGliteInterface): Promise<string> {
	const cached = secretCache.get(db);
	if (cached) return cached;

	const result = await db.query<{ value: string }>(
		`SELECT value FROM auth.config WHERE key = 'jwt_secret'`,
	);

	if (result.rows.length > 0 && result.rows[0]) {
		secretCache.set(db, result.rows[0].value);
		return result.rows[0].value;
	}

	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);

	await db.query(
		`INSERT INTO auth.config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
		["jwt_secret", secret],
	);

	secretCache.set(db, secret);
	return secret;
}

export async function createAccessToken(
	db: PGliteInterface,
	user: User,
	sessionId: string,
	expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY,
): Promise<string> {
	const secret = await getJWTSecret(db);
	const now = Math.floor(Date.now() / 1000);

	const payload: JWTPayload = {
		sub: user.id,
		aud: "authenticated",
		role: user.role,
		email: user.email || undefined,
		session_id: sessionId,
		iat: now,
		exp: now + expiresIn,
		user_metadata: user.user_metadata || {},
		app_metadata: user.app_metadata || {},
	};

	return signJWT(payload, secret);
}

export async function verifyAccessToken(
	db: PGliteInterface,
	token: string,
): Promise<{
	valid: boolean;
	payload?: {
		sub: string;
		aud: string;
		role: string;
		email?: string;
		session_id: string;
		iat: number;
		exp: number;
		user_metadata: Record<string, unknown>;
		app_metadata: Record<string, unknown>;
	};
	error?: string;
}> {
	const secret = await getJWTSecret(db);
	return verifyJWT(token, secret);
}

export async function generateTokenPair(
	db: PGliteInterface,
	user: User,
	sessionId: string,
	refreshToken: string,
	expiresIn: number = DEFAULT_ACCESS_TOKEN_EXPIRY,
): Promise<TokenPair> {
	const accessToken = await createAccessToken(db, user, sessionId, expiresIn);
	const now = Math.floor(Date.now() / 1000);

	return {
		accessToken,
		refreshToken,
		expiresIn,
		expiresAt: now + expiresIn,
	};
}

export function extractUserIdFromToken(token: string): string | null {
	const payload = decodeJWT(token);
	return payload?.sub || null;
}

export function extractSessionIdFromToken(token: string): string | null {
	const payload = decodeJWT(token);
	return payload?.session_id || null;
}
