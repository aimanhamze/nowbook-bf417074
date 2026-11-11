import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { academyImagePath, academyImagePathFromUrl } from "./academyImage";

const url = (path: string) => `https://proj.supabase.co/storage/v1/object/public/provider-images/${path}`;

describe("academy image paths", () => {
  it("lives in the owner's folder with a kind prefix", () => {
    expect(academyImagePath("u1", "instructor", "i9", { name: "me.PNG", type: "image/png" }, 42)).toBe(
      "u1/instructor-i9-42.png",
    );
    expect(academyImagePath("u1", "course", "c3", { name: "blob", type: "image/webp" }, 7)).toBe("u1/course-c3-7.webp");
  });

  it("only ever resolves this owner's file of this kind (so delete can't touch others)", () => {
    expect(academyImagePathFromUrl(url("u1/instructor-i9-42.png"), "u1", "instructor")).toBe("u1/instructor-i9-42.png");
    expect(academyImagePathFromUrl(url("u1/instructor-i9-42.png?t=1"), "u1", "instructor")).toBe("u1/instructor-i9-42.png");
    expect(academyImagePathFromUrl(url("u1/course-c3-7.webp"), "u1", "instructor")).toBeNull();
    expect(academyImagePathFromUrl(url("u2/instructor-i9-42.png"), "u1", "instructor")).toBeNull();
    expect(academyImagePathFromUrl(url("u1/cover-1.png"), "u1", "course")).toBeNull();
    expect(academyImagePathFromUrl("https://elsewhere.example/u1/course-c3-7.webp", "u1", "course")).toBeNull();
    expect(academyImagePathFromUrl(null, "u1", "course")).toBeNull();
  });
});
