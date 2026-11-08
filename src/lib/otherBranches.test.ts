import { describe, it, expect } from "vitest";
import { siblingBranches, ownerBranches, branchPillLabels } from "./otherBranches";
import { cityFromAddress } from "./cityFromAddress";
import type { Provider } from "./mock-data";

const p = (id: string, ownerId: string, name: string, address = ""): Provider =>
  ({
    id,
    ownerId,
    name: { he: name, ar: name, en: name },
    address: { he: address, ar: address, en: address },
  }) as Provider;

describe("siblingBranches", () => {
  const a = p("a", "o1", "Womed Sakhnin", "Sakhnin");
  const b = p("b", "o1", "Womed Arraba", "Arraba");
  const c = p("c", "o1", "Womed Acre", "Acre");
  const other = p("x", "o2", "Other Shop", "Haifa");

  it("lists the owner's other branches, never the one being viewed", () => {
    const ids = siblingBranches([a, b, c, other], a, "en").map((s) => s.id);
    expect(ids).toEqual(["c", "b"]); // sorted by name
    expect(ids).not.toContain("a");
  });

  it("is empty for a single-branch owner", () => {
    expect(siblingBranches([a, b, c, other], other, "en")).toEqual([]);
  });

  it("never lists another owner's providers", () => {
    expect(siblingBranches([a, other], a, "en")).toEqual([]);
  });

  it("only lists what is in the public list (a hidden branch is never in it)", () => {
    // b is hidden → useAllProviders never returns it.
    expect(siblingBranches([a, c], a, "en").map((s) => s.id)).toEqual(["c"]);
  });

  it("is empty when the owner id is missing", () => {
    const orphan = p("z", "", "Orphan");
    expect(siblingBranches([orphan, p("y", "", "Other orphan")], orphan, "en")).toEqual([]);
  });
});

describe("ownerBranches", () => {
  const a = p("a", "o1", "Womed Sakhnin", "Sakhnin");
  const b = p("b", "o1", "Womed Arraba", "Arraba");
  const solo = p("x", "o2", "Solo", "Haifa");

  it("includes the open branch, in one stable name order from any branch", () => {
    expect(ownerBranches([a, b, solo], a, "en").map((x) => x.id)).toEqual(["b", "a"]);
    expect(ownerBranches([a, b, solo], b, "en").map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("is empty for a single-branch owner, so nothing renders", () => {
    expect(ownerBranches([a, b, solo], solo, "en")).toEqual([]);
  });
});

describe("branchPillLabels", () => {
  it("labels each branch with its city", () => {
    const l = branchPillLabels([p("a", "o", "Womed Sakhnin", "Sakhnin"), p("b", "o", "Womed", "12 Main St, Arraba")], "en");
    expect([...l.values()]).toEqual(["Sakhnin", "Arraba"]);
  });

  it("falls back to the name for branches sharing a city (case-insensitive), only for those", () => {
    const l = branchPillLabels([
      p("a", "o", "Womed North", "Haifa"),
      p("b", "o", "Womed Carmel", "1 Hanassi, haifa"),
      p("c", "o", "Womed Acre", "Acre"),
    ], "en");
    expect(l.get("a")).toBe("Womed North");
    expect(l.get("b")).toBe("Womed Carmel");
    expect(l.get("c")).toBe("Acre");
  });

  it("falls back to the name when the address is empty", () => {
    const l = branchPillLabels([p("a", "o", "Womed", ""), p("b", "o", "Womed B", "Acre")], "en");
    expect(l.get("a")).toBe("Womed");
  });
});

describe("cityFromAddress (shared with ProviderCardGrid)", () => {
  it.each([
    ["Sakhnin", "Sakhnin"],
    ["12 Main St, Haifa", "Haifa"],
    ["  Main St ,  Acre.. ", "Acre"],
    ["Main St,", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%j -> %j", (input, expected) => {
    // Reference: the exact expression ProviderCardGrid used inline before.
    const full = (input ?? "").trim();
    const legacy = full ? full.split(",").pop()!.trim().replace(/\.+$/, "").trim() || null : null;
    expect(cityFromAddress(input)).toBe(legacy);
    expect(cityFromAddress(input)).toBe(expected);
  });
});
