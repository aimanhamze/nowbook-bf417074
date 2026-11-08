import { describe, it, expect } from "vitest";
import { categories } from "@/lib/mock-data";
import { ADMIN_CATEGORY_IDS, categoryLabels } from "./categoryLabels";

describe("admin category list", () => {
  it("offers every customer-facing category, each with a label", () => {
    for (const c of categories) {
      expect(ADMIN_CATEGORY_IDS).toContain(c.id);
      expect(categoryLabels[c.id]).toBeTruthy();
    }
  });

  it("admin and customer lists are the same set (academy is customer-visible since Phase 3)", () => {
    expect(ADMIN_CATEGORY_IDS).toContain("academy");
    expect([...ADMIN_CATEGORY_IDS].sort()).toEqual(categories.map((c) => c.id).sort());
  });
});
