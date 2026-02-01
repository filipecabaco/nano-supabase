/**
 * Auth module exports
 */

export { AuthHandler } from './handler.ts'
export { AUTH_SCHEMA_SQL, getSetAuthContextSQL, CLEAR_AUTH_CONTEXT_SQL } from './schema.ts'
export {
  createAccessToken,
  verifyAccessToken,
  generateTokenPair,
  extractUserIdFromToken,
  extractSessionIdFromToken,
} from './crypto.ts'
export type {
  User,
  Session,
  AuthResponse,
  AuthError,
  AuthChangeEvent,
  AuthStateChangeCallback,
  AuthSubscription,
  SignUpCredentials,
  SignInCredentials,
  TokenPair,
} from './types.ts'
