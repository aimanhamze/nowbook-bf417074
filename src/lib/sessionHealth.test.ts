import { describe, it, expect } from "vitest";
import { isDeadSessionError } from "./sessionHealth";

describe("isDeadSessionError", () => {
  it("recognises every documented dead-session code", () => {
    for (const code of [
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ]) {
      expect(isDeadSessionError({ code, status: 401 })).toBe(true);
    }
  });

  // The whole point of the classifier: an offline user must never be signed
  // out. These are the cases that would break that if the logic inverted.
  describe("never signs a user out for something transient", () => {
    it("ignores a retryable fetch error by name", () => {
      expect(isDeadSessionError({ name: "AuthRetryableFetchError" })).toBe(false);
    });

    it("ignores a retryable fetch error even if it ever gains a session code", () => {
      expect(
        isDeadSessionError({ name: "AuthRetryableFetchError", code: "session_not_found" }),
      ).toBe(false);
    });

    it("ignores errors with no code at all", () => {
      expect(isDeadSessionError({ status: 500 })).toBe(false);
      expect(isDeadSessionError({})).toBe(false);
    });

    it("ignores null and undefined", () => {
      expect(isDeadSessionError(null)).toBe(false);
      expect(isDeadSessionError(undefined)).toBe(false);
    });
  });

  describe("does not over-trigger on other auth failures", () => {
    it("ignores unrelated auth codes", () => {
      for (const code of [
        "invalid_credentials",
        "email_not_confirmed",
        "over_request_rate_limit",
        "user_banned",
        "validation_failed",
      ]) {
        expect(isDeadSessionError({ code, status: 400 })).toBe(false);
      }
    });

    it("does not match on a message-shaped string in the code field", () => {
      expect(
        isDeadSessionError({ code: "Session from session_id claim in JWT does not exist" }),
      ).toBe(false);
    });

    it("is exact, not prefix or substring based", () => {
      expect(isDeadSessionError({ code: "session_not_found_maybe" })).toBe(false);
      expect(isDeadSessionError({ code: "SESSION_NOT_FOUND" })).toBe(false);
      expect(isDeadSessionError({ code: " session_not_found" })).toBe(false);
    });
  });

  it("ignores a 401 that carries no recognised code", () => {
    // A bare 401 is not enough: it could be any number of things, and signing
    // the user out on it would be guesswork.
    expect(isDeadSessionError({ status: 401 })).toBe(false);
  });
});
