import { parseISO } from "date-fns";
import { classifyDay, type DayWindow } from "@/lib/availabilityResolver";
import type { TranslationKey } from "@/lib/translations";

/**
 * Waiting list — the pure rules the customer UI runs on. No React, no I/O.
 *
 * A day is offered for the waiting list only when it is GENUINELY full: the
 * resolver calls it "full" (the shop is open and the chosen member works, yet
 * no slot is left) AND the same slot pipeline run WITHOUT bookings would offer
 * at least one slot. classifyDay alone says "full" for days that lead time,
 * latest_start_time or a too-short window leave empty — no cancellation could
 * ever open those, so offering a waiting list there would be a promise we
 * cannot keep.
 */
export interface WaitlistDayInput {
  /** provider.waitlistEnabled, and the chosen service is private, not group,
   *  and has no scheduled sessions. False → never waitlistable (zero change). */
  eligible: boolean;
  /** The day is inside [today, booking-window end]. */
  inWindow: boolean;
  /** Any slot input still loading — fail closed, never flash the mark. */
  loading: boolean;
  /** useRealAvailability.resolveDayWindows(date). */
  shopWindow: DayWindow | null;
  narrowedWindow: DayWindow | null;
  /** Selectable slots as the time step would show them (after lead time). */
  usableSlots: readonly string[];
  /** The same, from getAvailableSlots(..., { ignoreBookings: true }). */
  usableSlotsIgnoringBookings: readonly string[];
  /** The customer already holds a confirmed/pending booking here that day —
   *  the join RPC refuses it (ALREADY_BOOKED), so never offer it. */
  customerHasBooking: boolean;
}

export function isWaitlistableDay(i: WaitlistDayInput): boolean {
  if (!i.eligible || !i.inWindow || i.loading || i.customerHasBooking) return false;
  if (classifyDay(i.shopWindow, i.narrowedWindow, i.usableSlots.length > 0) !== "full") return false;
  return i.usableSlotsIgnoringBookings.length > 0;
}

// ── Time of day ─────────────────────────────────────────────────────────────
// Judged on a slot's START, Israel wall clock — the same boundaries the
// dispatcher's matcher uses: morning < 12:00 <= afternoon < 17:00 <= evening.

export type TimeWindow = "morning" | "afternoon" | "evening";
export const TIME_WINDOWS: readonly TimeWindow[] = ["morning", "afternoon", "evening"];

function minutes(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function windowOf(slot: string): TimeWindow {
  const t = minutes(slot);
  if (t < 12 * 60) return "morning";
  if (t < 17 * 60) return "afternoon";
  return "evening";
}

/** The windows in which a cancellation could open a slot that day — computed
 *  from the bookings-ignored slots. A window with none is not offered. */
export function possibleWindows(slotsIgnoringBookings: readonly string[]): TimeWindow[] {
  const present = new Set(slotsIgnoringBookings.map(windowOf));
  return TIME_WINDOWS.filter((w) => present.has(w));
}

// ── RPC codes → copy ────────────────────────────────────────────────────────

export type WaitlistJoinCode =
  | "OK"
  | "NOT_CUSTOMER"
  | "WAITLIST_OFF"
  | "BAD_LANG"
  | "NO_WINDOW"
  | "DATE_OUT_OF_RANGE"
  | "SERVICE_INVALID"
  | "STAFF_INVALID"
  | "ALREADY_BOOKED"
  | "ALREADY_ON_LIST"
  | "LIMIT_REACHED";

const JOIN_ERROR_KEYS: Record<Exclude<WaitlistJoinCode, "OK">, TranslationKey> = {
  NOT_CUSTOMER: "waitlistErrNotCustomer",
  WAITLIST_OFF: "waitlistErrOff",
  BAD_LANG: "waitlistErrGeneric",
  NO_WINDOW: "waitlistErrNoWindow",
  DATE_OUT_OF_RANGE: "waitlistErrDate",
  SERVICE_INVALID: "waitlistErrService",
  STAFF_INVALID: "waitlistErrStaff",
  ALREADY_BOOKED: "waitlistErrAlreadyBooked",
  ALREADY_ON_LIST: "waitlistErrAlreadyOnList",
  LIMIT_REACHED: "waitlistErrLimit",
};

/** Translation key for a refusal. Anything unknown — a code a newer server
 *  adds, a network error — gets the generic message; raw text never shows. */
export function waitlistJoinErrorKey(code: string | null | undefined): TranslationKey {
  return code && Object.prototype.hasOwnProperty.call(JOIN_ERROR_KEYS, code)
    ? JOIN_ERROR_KEYS[code as keyof typeof JOIN_ERROR_KEYS]
    : "waitlistErrGeneric";
}

// ── Display ─────────────────────────────────────────────────────────────────

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

/** A waiting-list date ("yyyy-MM-dd") as "Thursday, 12 November" in the UI language. */
export function waitlistDateLabel(entryDate: string, lang: string): string {
  return parseISO(entryDate).toLocaleDateString(LOCALES[lang] ?? "he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const WINDOW_KEYS: Record<TimeWindow, TranslationKey> = {
  morning: "waitlistMorning",
  afternoon: "waitlistAfternoon",
  evening: "waitlistEvening",
};

/** "Morning · Evening", or "Any time" when all three were asked for. */
export function waitlistWindowsLabel(windows: readonly TimeWindow[], t: (k: TranslationKey) => string): string {
  if (windows.length === TIME_WINDOWS.length) return t("waitlistAnyTime");
  return TIME_WINDOWS.filter((w) => windows.includes(w)).map((w) => t(WINDOW_KEYS[w])).join(" · ");
}

// ── Provider list: phones ───────────────────────────────────────────────────
// waitlist_provider_day returns auth.users.phone (digits, "972…", no "+") or,
// failing that, profiles.phone as the customer typed it.

/** A tel: target: "972…" gains its "+", anything else is kept with only
 *  spaces/dashes removed. null when there is nothing dialable. */
export function waitlistTelHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s()-]/g, "");
  if (/^972\d{8,9}$/.test(compact)) return `tel:+${compact}`;
  if (/^\+?\d{6,15}$/.test(compact)) return `tel:${compact}`;
  return null;
}

/** How an Israeli number is read aloud locally: "972501234567" → "050-123-4567".
 *  Anything that is not an Israeli mobile/landline is shown as given. */
export function waitlistPhoneLabel(phone: string | null | undefined): string {
  const compact = (phone ?? "").trim().replace(/[\s()-]/g, "").replace(/^\+/, "");
  const local = /^972\d{8,9}$/.test(compact) ? `0${compact.slice(3)}` : compact;
  if (/^05\d{8}$/.test(local)) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (/^0[2-9]\d{7}$/.test(local)) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return (phone ?? "").trim();
}
