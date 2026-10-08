import { describe, expect, it } from "vitest";
import { ENTRY_STATE, isEntryPoint } from "./smartBack";

describe("isEntryPoint", () => {
  it("first entry in the tab (idx 0) is an entry point", () => {
    expect(isEntryPoint({ idx: 0, key: "default" }, null)).toBe(true);
  });

  it("an entry with in-app history behind it is not", () => {
    expect(isEntryPoint({ idx: 3, key: "abc" }, null)).toBe(false);
  });

  it("the post-login landing is an entry point even with history behind it", () => {
    expect(isEntryPoint({ idx: 1, key: "abc", usr: ENTRY_STATE }, ENTRY_STATE)).toBe(true);
  });

  it("unrelated location state does not count as the marker", () => {
    expect(isEntryPoint({ idx: 2 }, { tab: "services" })).toBe(false);
  });

  it("a missing or foreign history.state is treated as an entry point", () => {
    expect(isEntryPoint(null, null)).toBe(true);
    expect(isEntryPoint({ foo: 1 }, undefined)).toBe(true);
  });
});
