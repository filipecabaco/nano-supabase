/**
 * JWT utilities using Web Crypto API
 * Compatible with: Browser, Cloudflare Workers, Deno, Bun
 */

/**
 * Base64URL encode (no padding)
 */
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Text encoder/decoder (available in all modern runtimes)
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * JWT payload structure
 */
export interface JWTPayload {
  sub: string; // user ID
  aud: string; // audience ('authenticated')
  role: string; // user role
  email?: string; // user email
  session_id: string; // session ID
  iat: number; // issued at (seconds)
  exp: number; // expires at (seconds)
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
}

/**
 * Sign a JWT using HMAC-SHA256 (Web Crypto API)
 */
export async function signJWT(
  payload: JWTPayload,
  secret: string,
): Promise<string> {
  // Create header
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  // Encode header and payload
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;

  // Sign with HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));

  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${data}.${signatureB64}`;
}

/**
 * Verify a JWT signature using HMAC-SHA256 (Web Crypto API)
 */
export async function verifyJWT(
  token: string,
  secret: string,
): Promise<{
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { valid: false, error: "Invalid token format" };
    }

    const data = `${headerB64}.${payloadB64}`;

    // Verify signature
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signature = base64UrlDecode(signatureB64);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(data),
    );

    if (!isValid) {
      return { valid: false, error: "Invalid signature" };
    }

    // Decode payload
    const payloadJson = decoder.decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}

/**
 * Decode JWT payload without verification (for quick checks)
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadB64 = parts[1];
    if (!payloadB64) return null;

    const payloadJson = decoder.decode(base64UrlDecode(payloadB64));
    return JSON.parse(payloadJson) as JWTPayload;
  } catch {
    return null;
  }
}
