export { test, describe, expect } from "vitest";

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (
    typeof actual === "object" &&
    actual !== null &&
    typeof expected === "object" &&
    expected !== null
  ) {
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

export function assertExists(
  value: unknown,
  msg?: string,
): asserts value {
  if (value === null || value === undefined) {
    throw new Error(msg || `assertExists failed: value is ${value}`);
  }
}

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
