import { describe, it, expect } from "vitest";
import { supabaseErrorMessage, supabaseErrorCode } from "./supabaseError";

describe("supabaseErrorMessage", () => {
  // The regression this file exists for: a real PostgrestError payload is a
  // PLAIN object, so an `instanceof Error` guard would drop it entirely.
  it("reads a plain PostgREST error object", () => {
    const err = {
      code: "PGRST204",
      details: null,
      hint: null,
      message: "Could not find the 'duration_override' column of 'bookings' in the schema cache",
    };
    expect(err instanceof Error).toBe(false);
    expect(supabaseErrorMessage(err, "fallback")).toContain("duration_override");
  });

  it("reads a real Error too", () => {
    expect(supabaseErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads a bare string", () => {
    expect(supabaseErrorMessage("plain failure", "fallback")).toBe("plain failure");
  });

  it("falls back on shapes carrying no message", () => {
    expect(supabaseErrorMessage(null, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage({}, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage({ message: "   " }, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
    expect(supabaseErrorMessage(7, "fallback")).toBe("fallback");
  });
});

describe("supabaseErrorCode", () => {
  it("extracts the code when present", () => {
    expect(supabaseErrorCode({ code: "23505", message: "x" })).toBe("23505");
    expect(supabaseErrorCode({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("returns null when absent or unusable", () => {
    expect(supabaseErrorCode({ message: "x" })).toBeNull();
    expect(supabaseErrorCode({ code: "" })).toBeNull();
    expect(supabaseErrorCode({ code: 500 })).toBeNull();
    expect(supabaseErrorCode(null)).toBeNull();
    expect(supabaseErrorCode(new Error("x"))).toBeNull();
  });
});
