/**
 * Auth module exports
 */

export {
	createAccessToken,
	extractSessionIdFromToken,
	extractUserIdFromToken,
	generateTokenPair,
	verifyAccessToken,
} from "./crypto.ts";
export { AuthHandler } from "./handler.ts";
export {
	AUTH_SCHEMA_SQL,
	CLEAR_AUTH_CONTEXT_SQL,
	getSetAuthContextSQL,
} from "./schema.ts";
export type {
	AuthChangeEvent,
	AuthError,
	AuthResponse,
	AuthStateChangeCallback,
	AuthSubscription,
	Session,
	SignInCredentials,
	SignUpCredentials,
	TokenPair,
	User,
} from "./types.ts";
