import { describe, it, expect, vi, beforeEach } from "vitest";

const upload = vi.fn();
const remove = vi.fn();
const getPublicUrl = vi.fn((path: string) => ({
  data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/provider-images/${path}` },
}));
const from = vi.fn((_bucket: string) => ({ upload, remove, getPublicUrl }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (bucket: string) => from(bucket) } },
}));

import {
  SERVICE_IMAGE_MAX_BYTES,
  deleteServiceImage,
  serviceImageExtension,
  serviceImagePath,
  serviceImagePathFromUrl,
  uploadServiceImage,
  validateServiceImage,
} from "./serviceImage";

const USER = "user-1";
const url = (path: string) => `https://proj.supabase.co/storage/v1/object/public/provider-images/${path}`;

beforeEach(() => {
  upload.mockReset();
  remove.mockReset();
  from.mockClear();
  getPublicUrl.mockClear();
});

describe("validateServiceImage", () => {
  it("accepts an image within the limit, including exactly 5MB", () => {
    expect(validateServiceImage({ type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateServiceImage({ type: "image/png", size: SERVICE_IMAGE_MAX_BYTES })).toBeNull();
  });

  it("rejects anything over 5MB", () => {
    expect(validateServiceImage({ type: "image/webp", size: SERVICE_IMAGE_MAX_BYTES + 1 })).toBe("IMAGE_TOO_LARGE");
  });

  it("rejects non-image and untyped files", () => {
    expect(validateServiceImage({ type: "application/pdf", size: 10 })).toBe("IMAGE_INVALID_TYPE");
    expect(validateServiceImage({ type: "", size: 10 })).toBe("IMAGE_INVALID_TYPE");
  });
});

describe("serviceImageExtension / serviceImagePath", () => {
  it("uses the lowercased file extension", () => {
    expect(serviceImageExtension({ name: "Photo.JPEG", type: "image/jpeg" })).toBe("jpeg");
  });

  it("falls back to the MIME type, then jpg", () => {
    expect(serviceImageExtension({ name: "noext", type: "image/png" })).toBe("png");
    expect(serviceImageExtension({ name: "noext", type: "image/x-unknown" })).toBe("jpg");
  });

  it("strips characters that do not belong in a path", () => {
    expect(serviceImageExtension({ name: "a.p/n g", type: "image/png" })).toBe("png");
  });

  it("builds {uid}/service-{serviceId}-{ts}.{ext}", () => {
    expect(serviceImagePath(USER, "svc-9", { name: "x.webp", type: "image/webp" }, 1700000000000))
      .toBe("user-1/service-svc-9-1700000000000.webp");
  });
});

describe("serviceImagePathFromUrl", () => {
  it("returns the path of the owner's own service image", () => {
    expect(serviceImagePathFromUrl(url("user-1/service-s1-1.jpg"), USER)).toBe("user-1/service-s1-1.jpg");
  });

  it("ignores query strings and decodes the path", () => {
    expect(serviceImagePathFromUrl(`${url("user-1/service-s%201-1.jpg")}?t=1`, USER)).toBe("user-1/service-s 1-1.jpg");
  });

  it("never targets the owner's cover/avatar, another owner, another bucket or an external URL", () => {
    expect(serviceImagePathFromUrl(url("user-1/cover-1.jpg"), USER)).toBeNull();
    expect(serviceImagePathFromUrl(url("user-2/service-s1-1.jpg"), USER)).toBeNull();
    expect(serviceImagePathFromUrl("https://proj.supabase.co/storage/v1/object/public/provider-photos/user-1/service-s1-1.jpg", USER)).toBeNull();
    expect(serviceImagePathFromUrl("https://images.unsplash.com/photo.jpg", USER)).toBeNull();
    expect(serviceImagePathFromUrl(null, USER)).toBeNull();
    expect(serviceImagePathFromUrl("", USER)).toBeNull();
  });
});

describe("uploadServiceImage", () => {
  it("uploads to provider-images under the owner folder and returns the public URL", async () => {
    upload.mockResolvedValue({ error: null });
    const file = new File(["x"], "pic.png", { type: "image/png" });

    const publicUrl = await uploadServiceImage({ userId: USER, serviceId: "s1", file });

    expect(from).toHaveBeenCalledWith("provider-images");
    const [path, sent, opts] = upload.mock.calls[0];
    expect(path).toMatch(/^user-1\/service-s1-\d+\.png$/);
    expect(sent).toBe(file);
    expect(opts).toMatchObject({ contentType: "image/png" });
    expect(publicUrl).toBe(url(path));
  });

  it("throws when the storage upload fails", async () => {
    upload.mockResolvedValue({ error: new Error("denied") });
    const file = new File(["x"], "pic.png", { type: "image/png" });
    await expect(uploadServiceImage({ userId: USER, serviceId: "s1", file })).rejects.toThrow("denied");
  });
});

describe("deleteServiceImage", () => {
  it("removes the owner's own service image", async () => {
    remove.mockResolvedValue({ error: null });
    await expect(deleteServiceImage(url("user-1/service-s1-1.jpg"), USER)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith(["user-1/service-s1-1.jpg"]);
  });

  it("does not call storage for a URL it does not own", async () => {
    await expect(deleteServiceImage(url("user-1/avatar-1.jpg"), USER)).resolves.toBe(false);
    await expect(deleteServiceImage(null, USER)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never throws, even when storage errors or rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    remove.mockResolvedValueOnce({ error: new Error("nope") });
    await expect(deleteServiceImage(url("user-1/service-s1-1.jpg"), USER)).resolves.toBe(false);
    remove.mockRejectedValueOnce(new Error("network"));
    await expect(deleteServiceImage(url("user-1/service-s1-1.jpg"), USER)).resolves.toBe(false);
    warn.mockRestore();
  });
});
