import { describe, it, expect } from "vitest";
import { siblingBranches, branchCityLabel } from "./otherBranches";
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

describe("branchCityLabel", () => {
  it("shows the city when the name doesn't contain it", () => {
    expect(branchCityLabel("Womed", "Sakhnin")).toBe("Sakhnin");
  });

  it("hides the city when the name already contains it (case-insensitive)", () => {
    expect(branchCityLabel("Womed Sakhnin", "sakhnin")).toBeNull();
    expect(branchCityLabel("ומד סכנין", "סכנין")).toBeNull();
  });

  it("uses the last segment of a full address", () => {
    expect(branchCityLabel("Womed", "12 Main St, Sakhnin.")).toBe("Sakhnin");
  });

  it("is null for an empty address", () => {
    expect(branchCityLabel("Womed", "")).toBeNull();
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
