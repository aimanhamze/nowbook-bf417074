import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// supabase/functions/_shared/availabilityResolver.ts is a COPY of
// src/lib/availabilityResolver.ts, used by the waitlist-dispatch Edge Function
// to decide whether a freed slot is inside the provider's (and the staff
// member's) hours. It is a copy rather than an import because the Edge
// Function bundler is not guaranteed to follow imports outside
// supabase/functions/.
//
// The two MUST stay byte-identical: if they drift, the server can announce a
// slot the booking page will not offer, or stay silent about one it would.
// The copy carries no header of its own for exactly that reason.
//
// To fix a failure: make the change in src/lib/availabilityResolver.ts, then
//   cp src/lib/availabilityResolver.ts supabase/functions/_shared/availabilityResolver.ts
// and redeploy waitlist-dispatch.

const repoRoot = path.resolve(__dirname, "../..");

describe("availabilityResolver server copy", () => {
  it("is byte-identical to src/lib/availabilityResolver.ts", () => {
    const original = readFileSync(path.join(repoRoot, "src/lib/availabilityResolver.ts"));
    const copy = readFileSync(path.join(repoRoot, "supabase/functions/_shared/availabilityResolver.ts"));
    expect(copy.equals(original)).toBe(true);
  });
});
