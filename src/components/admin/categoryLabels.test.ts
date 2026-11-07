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

  it("offers academy to admins only (not yet in the customer list)", () => {
    expect(ADMIN_CATEGORY_IDS).toContain("academy");
    expect((categories as readonly { id: string }[]).some((c) => c.id === "academy")).toBe(false);
  });
});
