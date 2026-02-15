/**
 * Runtime-agnostic test compatibility layer.
 *
 * Provides `test`, `describe`, `assertEquals`, `assertExists`, and
 * `assertNotEquals` that work identically under both Deno (`deno test`)
 * and Bun (`bun test`).
 *
 * Usage:
 *   import { test, describe, assertEquals, assertExists } from "./compat.ts";
 */

type TestFn = () => Promise<void> | void;

// ── Runtime detection ────────────────────────────────────────────────────────

// @ts-ignore: Deno global
const isDeno = typeof globalThis.Deno !== "undefined";

// ── Test registration ────────────────────────────────────────────────────────

let _test: (name: string, fn: TestFn) => void;
let _describe: (name: string, fn: () => void) => void;

if (isDeno) {
  // Track current describe block for prefixed test names
  let _currentDescribe = "";

  _describe = (name: string, fn: () => void) => {
    const prev = _currentDescribe;
    _currentDescribe = prev ? `${prev} > ${name}` : name;
    fn();
    _currentDescribe = prev;
  };

  _test = (name: string, fn: TestFn) => {
    const fullName = _currentDescribe
      ? `${_currentDescribe} > ${name}`
      : name;
    // @ts-ignore: Deno global
    globalThis.Deno.test(fullName, fn);
  };
} else {
  // Dynamic import so Deno never tries to resolve "bun:test"
  // @ts-ignore: bun:test is Bun-only
  const m = await import("bun:test");
  _test = m.test;
  _describe = m.describe;
}

export const test: (name: string, fn: TestFn) => void = _test;
export const describe: (name: string, fn: () => void) => void = _describe;

// ── Assertions ───────────────────────────────────────────────────────────────

/**
 * Deep-equal comparison for objects/arrays, strict-equal for primitives.
 */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (
    typeof actual === "object" &&
    actual !== null &&
    typeof expected === "object" &&
    expected !== null
  ) {
    // Deep comparison via JSON (handles arrays, plain objects, Uint8Array via toJSON)
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error(
        msg ||
          `assertEquals failed:\n  actual:   ${a}\n  expected: ${e}`,
      );
    }
    return;
  }
  if (!Object.is(actual, expected)) {
    throw new Error(
      msg ||
        `assertEquals failed:\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * Assert a value is neither `null` nor `undefined`.
 */
export function assertExists(
  value: unknown,
  msg?: string,
): asserts value {
  if (value === null || value === undefined) {
    throw new Error(msg || `assertExists failed: value is ${value}`);
  }
}

/**
 * Assert two values are NOT equal.
 */
export function assertNotEquals<T>(
  actual: T,
  expected: T,
  msg?: string,
): void {
  if (Object.is(actual, expected)) {
    throw new Error(
      msg ||
        `assertNotEquals failed: both values are ${JSON.stringify(actual)}`,
    );
  }
}
