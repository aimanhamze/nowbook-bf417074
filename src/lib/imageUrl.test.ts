import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";
import { imageTransformsEnabled, sized, withOriginalFallback } from "./imageUrl";

const OWN = "https://aqlcjjrgsxispdjwrnqf.supabase.co";
const obj = (path: string) => `${OWN}/storage/v1/object/public/${path}`;
const render = (path: string) => `${OWN}/storage/v1/render/image/public/${path}`;

describe("sized", () => {
  it("rewrites own-host public object URLs to the render endpoint with params", () => {
    expect(sized(obj("provider-photos/u1/1790781816142.jpeg"), { width: 600 })).toBe(
      `${render("provider-photos/u1/1790781816142.jpeg")}?width=600`,
    );
    expect(
      sized(obj("provider-images/u1/cover-1.jpeg"), { width: 128, height: 128, quality: 70, resize: "contain" }),
    ).toBe(`${render("provider-images/u1/cover-1.jpeg")}?width=128&height=128&quality=70&resize=contain`);
  });

  it("keeps an existing query string and overrides our own params", () => {
    expect(sized(`${obj("provider-images/u1/a.png")}?t=5&width=9999`, { width: 200 })).toBe(
      `${render("provider-images/u1/a.png")}?t=5&width=200`,
    );
  });

  it("returns other hosts unchanged", () => {
    const unsplash = "https://images.unsplash.com/photo-1?w=400&h=400&fit=crop";
    const seed = "https://kvfgdbmjqquyisagpyml.supabase.co/storage/v1/object/public/provider-images/body-pt-cover.jpg";
    const lookalike = "https://aqlcjjrgsxispdjwrnqf.supabase.co.evil.test/storage/v1/object/public/x/y.jpg";
    expect(sized(unsplash, { width: 200 })).toBe(unsplash);
    expect(sized(seed, { width: 200 })).toBe(seed);
    expect(sized(lookalike, { width: 200 })).toBe(lookalike);
  });

  it("returns non-object paths on our host unchanged (signed, already rendered)", () => {
    const signed = `${OWN}/storage/v1/object/sign/provider-photos/a.jpg?token=x`;
    const rendered = `${render("provider-photos/a.jpg")}?width=50`;
    expect(sized(signed, { width: 200 })).toBe(signed);
    expect(sized(rendered, { width: 200 })).toBe(rendered);
  });

  it("returns empty, null, undefined, data: and blob: unchanged", () => {
    expect(sized("", { width: 200 })).toBe("");
    expect(sized(null, { width: 200 })).toBeNull();
    expect(sized(undefined, { width: 200 })).toBeUndefined();
    expect(sized("data:image/png;base64,AAAA", { width: 200 })).toBe("data:image/png;base64,AAAA");
    expect(sized("blob:https://app.test/123", { width: 200 })).toBe("blob:https://app.test/123");
    expect(sized("not a url", { width: 200 })).toBe("not a url");
  });
});

describe("VITE_IMAGE_TRANSFORMS kill switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const original = obj("provider-photos/u1/a.jpeg");

  it("is on when unset", () => {
    vi.stubEnv("VITE_IMAGE_TRANSFORMS", undefined);
    expect(imageTransformsEnabled()).toBe(true);
    expect(sized(original, { width: 600 })).toBe(`${render("provider-photos/u1/a.jpeg")}?width=600`);
  });

  it("is on for 'on' (and any value other than off)", () => {
    vi.stubEnv("VITE_IMAGE_TRANSFORMS", "on");
    expect(sized(original, { width: 600 })).toBe(`${render("provider-photos/u1/a.jpeg")}?width=600`);
    vi.stubEnv("VITE_IMAGE_TRANSFORMS", "");
    expect(imageTransformsEnabled()).toBe(true);
  });

  it("returns every URL unchanged when 'off' (case/space-insensitive)", () => {
    for (const value of ["off", "OFF", " Off "]) {
      vi.stubEnv("VITE_IMAGE_TRANSFORMS", value);
      expect(imageTransformsEnabled()).toBe(false);
      expect(sized(original, { width: 600 })).toBe(original);
      expect(sized(original, { width: 1600, resize: "contain" })).toBe(original);
      expect(sized(null, { width: 600 })).toBeNull();
    }
  });
});

describe("withOriginalFallback", () => {
  const fire = (img: HTMLImageElement, handler: (e: SyntheticEvent<HTMLImageElement>) => void) =>
    handler({ currentTarget: img } as unknown as SyntheticEvent<HTMLImageElement>);

  it("swaps to the original once, then hands later errors to the final handler", () => {
    const original = obj("provider-photos/u1/a.jpeg");
    const img = document.createElement("img");
    img.setAttribute("src", sized(original, { width: 300 }));
    const final = vi.fn();
    const onError = withOriginalFallback(original, final);

    fire(img, onError);
    expect(img.getAttribute("src")).toBe(original);
    expect(final).not.toHaveBeenCalled();

    fire(img, onError);
    expect(final).toHaveBeenCalledTimes(1);
    expect(img.getAttribute("src")).toBe(original);
  });

  it("goes straight to the final handler when src already is the original", () => {
    const original = "https://images.unsplash.com/photo-1?w=400";
    const img = document.createElement("img");
    img.setAttribute("src", original);
    const final = vi.fn();
    fire(img, withOriginalFallback(original, final));
    expect(final).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh fallback when the element is reused for a different original", () => {
    const a = obj("provider-images/u1/a.jpeg");
    const b = obj("provider-images/u1/b.jpeg");
    const img = document.createElement("img");
    img.setAttribute("src", sized(a, { width: 300 }));
    fire(img, withOriginalFallback(a));
    expect(img.getAttribute("src")).toBe(a);

    img.setAttribute("src", sized(b, { width: 300 }));
    fire(img, withOriginalFallback(b));
    expect(img.getAttribute("src")).toBe(b);
  });

  it("does nothing harmful with no original and no final handler", () => {
    const img = document.createElement("img");
    img.setAttribute("src", "x");
    expect(() => fire(img, withOriginalFallback(null))).not.toThrow();
    expect(img.getAttribute("src")).toBe("x");
  });
});
