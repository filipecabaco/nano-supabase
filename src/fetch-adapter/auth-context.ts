/**
 * Auth context management for RLS policies
 * Handles setting and clearing PostgreSQL session context for authenticated requests
 */

import type { PGlite } from "@electric-sql/pglite";
import { verifyAccessToken } from "../auth/crypto.ts";
import {
  getSetAuthContextSQL,
  CLEAR_AUTH_CONTEXT_SQL,
} from "../auth/schema.ts";

export interface AuthContext {
  userId?: string;
  role: string;
  email?: string;
}

/**
 * Set auth context for authenticated request
 */
export async function setAuthContext(
  db: PGlite,
  token: string | null,
): Promise<AuthContext> {
  if (!token) {
    await db.exec(CLEAR_AUTH_CONTEXT_SQL);
    return { role: "anon" };
  }

  const verified = await verifyAccessToken(db, token);
  if (!verified.valid || !verified.payload) {
    await db.exec(CLEAR_AUTH_CONTEXT_SQL);
    return { role: "anon" };
  }

  const { sub: userId, role, email } = verified.payload;
  const sql = getSetAuthContextSQL(userId, role, email || "");
  await db.exec(sql);

  return { userId, role, email };
}

/**
 * Clear auth context (set to anonymous)
 */
export async function clearAuthContext(db: PGlite): Promise<void> {
  await db.exec(CLEAR_AUTH_CONTEXT_SQL);
}
