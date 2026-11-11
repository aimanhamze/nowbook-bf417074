// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The services redesign is UI only. These pin what it must keep: the service
 * save sends the same upsertService payload (private capacity 1, NULL latest
 * start, stored notes placeholder default), nothing writes on load, the colour
 * switch and fixed dates save immediately through their own mutations, delete
 * keeps its confirm + future-bookings message, and errors are translated.
 */

const mutation = (value: unknown = undefined) => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(value) });
let m: Record<string, ReturnType<typeof mutation>>;
let services: Array<Record<string, unknown>>;
let sessions: Array<Record<string, unknown>>;
let profile: Record<string, unknown>;

vi.mock("@/hooks/useProviderProfile", () => ({
  useProviderProfile: () => ({ profile, branches: [], updateServiceColorsEnabled: m.updateServiceColorsEnabled }),
}));
vi.mock("@/hooks/useProviderServices", () => ({
  useProviderServices: () => ({
    services, isLoading: false,
    upsertService: m.upsertService, deleteService: m.deleteService, updateServiceParallel: m.updateServiceParallel,
  }),
}));
vi.mock("@/hooks/useProviderSessions", () => ({
  useProviderSessions: () => ({ sessions, addSession: m.addSession, deleteSession: m.deleteSession }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ServicesTab } = await import("./ServicesTab");

beforeEach(() => {
  m = {
    upsertService: mutation({ id: "s1", imageError: false }),
    deleteService: mutation(),
    updateServiceParallel: mutation(),
    updateServiceColorsEnabled: mutation(),
    addSession: mutation(),
    deleteSession: mutation(),
  };
  profile = { id: "pp1", category: "barber", service_colors_enabled: false };
  services = [{
    id: "s1", name: "Haircut", duration: 30, price: 60, service_type: "private", max_capacity: 1,
    latest_start_time: "18:00:00", customer_notes_enabled: false, customer_notes_placeholder: null,
    color: "#3b82f6", image_url: null, is_parallel: false,
  }];
  sessions = [];
  toast.success.mockClear();
  toast.error.mockClear();
});

const dialog = () => screen.getByRole("dialog");

describe("ServicesTab", () => {
  it("writes nothing on load and shows price only when above 0", () => {
    render(<ServicesTab />);
    for (const k of Object.keys(m)) expect(m[k].mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Haircut/ })).toHaveTextContent("₪60");
  });

  it("editing sends the same upsertService payload as before", async () => {
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Haircut/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "latestStartTimeClear" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "save" }));
    await waitFor(() => expect(m.upsertService.mutateAsync).toHaveBeenCalledWith({
      id: "s1", name: "Haircut", duration: 30, price: 60, service_type: "private", color: "#3b82f6",
      max_capacity: 1, latest_start_time: null, customer_notes_enabled: false,
      customer_notes_placeholder: "הוסף הערות לשירות...",
      imageFile: null, removeImage: false, current_image_url: null,
    }));
    expect(toast.success).toHaveBeenCalledWith("serviceSaved");
  });

  it("validation messages are translated", async () => {
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Haircut/ }));
    fireEvent.change(within(dialog()).getByLabelText("duration"), { target: { value: "2" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("svErrDurationMin"));
    expect(m.upsertService.mutateAsync).not.toHaveBeenCalled();
  });

  it("a failed save never shows the raw error", async () => {
    m.upsertService.mutateAsync.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Haircut/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
  });

  it("the colour switch saves immediately through its own mutation", async () => {
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("switch", { name: /serviceColors/ }));
    await waitFor(() => expect(m.updateServiceColorsEnabled.mutateAsync).toHaveBeenCalledWith(true));
    expect(m.upsertService.mutateAsync).not.toHaveBeenCalled();
  });

  it("fixed dates add immediately with the same session row", async () => {
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Haircut/ }));
    fireEvent.change(within(dialog()).getByLabelText("svDateLabel"), { target: { value: "2030-01-05" } });
    fireEvent.change(within(dialog()).getByLabelText("svTimeLabel"), { target: { value: "10:30" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "svDatesAdd" }));
    await waitFor(() => expect(m.addSession.mutateAsync).toHaveBeenCalledWith({
      service_id: "s1", session_date: "2030-01-05", session_time: "10:30",
    }));
    expect(m.upsertService.mutateAsync).not.toHaveBeenCalled();
  });

  it("a new service has no fixed-dates block (it needs an id first)", () => {
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /addService/ }));
    expect(within(dialog()).queryByText("svDatesTitle")).toBeNull();
  });

  it("delete confirms, and a service with future bookings keeps its message", async () => {
    m.deleteService.mutateAsync.mockRejectedValueOnce(new Error("HAS_FUTURE_BOOKINGS"));
    render(<ServicesTab />);
    fireEvent.click(screen.getByRole("button", { name: /Haircut/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "deleteService" }));
    fireEvent.click(await screen.findByRole("button", { name: "deleteService", hidden: false }));
    await waitFor(() => expect(m.deleteService.mutateAsync).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("serviceHasBookings"));
  });
});
