// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Photos must work with taps alone (the old grid hid delete/reorder behind
 * :hover). Only clicks are used here — no hover, no pointer-over — and the
 * mutations must receive what they did before.
 */

const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
let m: Record<string, ReturnType<typeof mutation>>;
let photos: Array<{ id: string; url: string; caption: string | null }>;

vi.mock("@/hooks/useProviderPhotos", () => ({
  useProviderPhotos: () => ({ photos, isLoading: false, maxPhotos: 20, ...m }),
}));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile: { id: "pp1" }, branches: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { PhotosTab } = await import("./PhotosTab");

beforeEach(() => {
  m = { uploadPhoto: mutation(), deletePhoto: mutation(), reorderPhotos: mutation() };
  photos = [
    { id: "a", url: "https://x/a.jpg", caption: null },
    { id: "b", url: "https://x/b.jpg", caption: "Front" },
    { id: "c", url: "https://x/c.jpg", caption: null },
  ];
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("PhotosTab (touch only)", () => {
  it("writes nothing on load", () => {
    render(<PhotosTab />);
    for (const k of Object.keys(m)) expect(m[k].mutateAsync).not.toHaveBeenCalled();
  });

  it("a tap opens the photo; move later sends the reordered ids", async () => {
    render(<PhotosTab />);
    fireEvent.click(screen.getAllByRole("button", { name: /^phPosition/ })[0]);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "phMoveEarlier" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "phMoveLater" }));
    await waitFor(() => expect(m.reorderPhotos.mutateAsync).toHaveBeenCalledWith(["b", "a", "c"]));
  });

  it("delete asks first, then deletes that photo", async () => {
    render(<PhotosTab />);
    fireEvent.click(screen.getAllByRole("button", { name: /^phPosition/ })[1]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "deletePhoto" }));
    expect(m.deletePhoto.mutateAsync).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "deletePhoto" }));
    await waitFor(() => expect(m.deletePhoto.mutateAsync).toHaveBeenCalledWith("b"));
    expect(toast.success).toHaveBeenCalledWith("phDeleted");
  });

  it("add: the caption goes with the picked file", async () => {
    render(<PhotosTab />);
    fireEvent.click(screen.getByRole("button", { name: "phAddTitle" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("photoCaption"), { target: { value: "Chair" } });
    const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("phChoose", { selector: "input" }), { target: { files: [file] } });
    await waitFor(() => expect(m.uploadPhoto.mutateAsync).toHaveBeenCalledWith({ file, caption: "Chair" }));
  });

  it("errors are translated, never raw", async () => {
    m.reorderPhotos.mutateAsync.mockRejectedValueOnce(new Error("permission denied for table provider_photos"));
    render(<PhotosTab />);
    fireEvent.click(screen.getAllByRole("button", { name: /^phPosition/ })[2]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "phMoveEarlier" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
  });
});

