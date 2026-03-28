/**
 * Auth context management for RLS policies
 * Handles setting and clearing PostgreSQL session context for authenticated requests
 */

import type { PGliteInterface } from "@electric-sql/pglite";
import { verifyAccessToken } from "../auth/crypto.ts";
import {
	CLEAR_AUTH_CONTEXT_SQL,
	getSetAuthContextSQL,
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
	db: PGliteInterface,
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
	const resolvedRole = role ?? "authenticated";
	const sql = getSetAuthContextSQL(userId, resolvedRole, email || "");
	await db.exec(sql);

	return { userId, role: resolvedRole, email };
}

/**
 * Clear auth context (set to anonymous)
 */
export async function clearAuthContext(db: PGliteInterface): Promise<void> {
	await db.exec(CLEAR_AUTH_CONTEXT_SQL);
}
