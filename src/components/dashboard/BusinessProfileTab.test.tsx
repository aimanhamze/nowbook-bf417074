// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The profile redesign moved one big form into a sheet per field. What it must
 * keep: every Save sends the SAME full upsertProfile payload the old form sent
 * (stored values for untouched fields, the WhatsApp→phone fallback), nothing is
 * written on load or by an unchanged Save, templates save through their own
 * mutation, and errors are translated, never raw.
 */

const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
let m: Record<string, ReturnType<typeof mutation>>;
let profile: Record<string, unknown>;

vi.mock("@/hooks/useProviderProfile", () => ({
  useProviderProfile: () => ({ profile, branches: [], ...m }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { BusinessProfileTab, DEFAULT_REMINDER_TEMPLATE } = await import("./BusinessProfileTab");

// What the old form's submit sent for this profile, untouched.
const STORED_PAYLOAD = {
  business_name: "Salon Noor",
  category: "salon",
  address: "Main St 1",
  about: "",
  phone: "050-1234567",
  // Old reset(): whatsapp = social_links.whatsapp || phone → buildSocialLinks.
  social_links: { whatsapp: "+972501234567", instagram: "https://instagram.com/noor" },
  latitude: 32.1,
  longitude: 34.8,
};

beforeEach(() => {
  m = Object.fromEntries(
    ["upsertProfile", "updateWhatsAppTemplates", "uploadCoverImage", "uploadAvatarImage"].map((k) => [k, mutation()]),
  );
  profile = {
    id: "pp1", business_name: "Salon Noor", category: "salon", address: "Main St 1", about: null,
    phone: "050-1234567", social_links: { instagram: "noor" }, latitude: 32.1, longitude: 34.8,
    avatar_image: null, cover_image: null, deposit_message_template: null, reminder_message_template: null,
  };
  toast.success.mockClear();
  toast.error.mockClear();
});

const openRow = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
const dialog = () => screen.getByRole("dialog");
const save = () => fireEvent.click(within(dialog()).getByRole("button", { name: "save" }));

describe("BusinessProfileTab", () => {
  it("writes nothing on load", () => {
    render(<BusinessProfileTab />);
    for (const k of Object.keys(m)) expect(m[k].mutateAsync).not.toHaveBeenCalled();
  });

  it("a field sheet sends the full stored payload with only that field changed", async () => {
    render(<BusinessProfileTab />);
    openRow("pfNameTitle");
    fireEvent.change(within(dialog()).getByRole("textbox"), { target: { value: "Noor Studio" } });
    save();
    await waitFor(() =>
      expect(m.upsertProfile.mutateAsync).toHaveBeenCalledWith({ ...STORED_PAYLOAD, business_name: "Noor Studio" }),
    );
    expect(toast.success).toHaveBeenCalledWith("profileSaved");
  });

  it("an unchanged Save writes nothing", async () => {
    render(<BusinessProfileTab />);
    openRow("pfAddressTitle");
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.upsertProfile.mutateAsync).not.toHaveBeenCalled();
  });

  it("clearing the map pin saves NULL coordinates and nothing else changes", async () => {
    render(<BusinessProfileTab />);
    openRow("pfPinTitle");
    fireEvent.click(within(dialog()).getByRole("button", { name: "locationClearLocation" }));
    save();
    await waitFor(() =>
      expect(m.upsertProfile.mutateAsync).toHaveBeenCalledWith({ ...STORED_PAYLOAD, latitude: null, longitude: null }),
    );
  });

  it("validation messages are translated and block the save", async () => {
    render(<BusinessProfileTab />);
    openRow("pfNameTitle");
    fireEvent.change(within(dialog()).getByRole("textbox"), { target: { value: "N" } });
    save();
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("pfErrNameShort");
    expect(m.upsertProfile.mutateAsync).not.toHaveBeenCalled();
  });

  it("a failed save shows a translated toast, never the raw error", async () => {
    m.upsertProfile.mutateAsync.mockRejectedValueOnce(new Error('new row violates check constraint "x"'));
    render(<BusinessProfileTab />);
    openRow("pfPhoneTitle");
    fireEvent.change(within(dialog()).getByRole("textbox"), { target: { value: "050-7654321" } });
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
  });

  it("templates save through their own mutation; a NULL template opens on the default", async () => {
    render(<BusinessProfileTab />);
    openRow("pfReminderTitle");
    const box = within(dialog()).getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe(DEFAULT_REMINDER_TEMPLATE);
    fireEvent.change(box, { target: { value: "Hi {customer_name}" } });
    save();
    await waitFor(() =>
      expect(m.updateWhatsAppTemplates.mutateAsync).toHaveBeenCalledWith({ reminder_message_template: "Hi {customer_name}" }),
    );
    expect(m.upsertProfile.mutateAsync).not.toHaveBeenCalled();
  });
});
