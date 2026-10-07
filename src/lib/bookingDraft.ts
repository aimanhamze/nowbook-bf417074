/** Keeps a customer's in-progress booking across a forced re-login.
 *
 *  When the session turns out to be dead at "confirm", the customer is sent to
 *  /auth. Without this they would return to an empty wizard and have to pick
 *  everything again — on the most important path in the app.
 *
 *  localStorage, not sessionStorage: a login that opens a new tab (or an
 *  in-app browser handing off to another view) would lose sessionStorage.
 *  Bounded instead by a 30-minute expiry and by the user id, so a draft is
 *  only ever restored to the same account, on the same provider, soon after.
 *  Every read consumes the value — a draft restores exactly once. */

const KEY = "bookingDraft";
export const BOOKING_DRAFT_TTL_MS = 30 * 60 * 1000;

export interface BookingDraft {
  userId: string;
  providerId: string;
  savedAt: number;
  // Standard flow
  serviceId?: string;
  staffId?: string;
  sessionId?: string;
  /** yyyy-MM-dd */
  date?: string;
  /** HH:mm */
  time?: string;
  notes?: string;
  // Fitness flow
  classId?: string;
  /** yyyy-MM-dd */
  occurrence?: string;
}

export function saveBookingDraft(draft: Omit<BookingDraft, "savedAt">, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    // Storage unavailable — the customer re-picks after login, as before.
  }
}

/** Returns the draft for this user and provider and clears it. A draft that
 *  is expired, malformed or another user's is cleared and null returned; one
 *  for a different provider of the same user is left for that provider. */
export function consumeBookingDraft(
  userId: string,
  providerId: string,
  now = Date.now(),
): BookingDraft | null {
  let draft: BookingDraft | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    draft = JSON.parse(raw) as BookingDraft;
  } catch {
    clearBookingDraft();
    return null;
  }

  const valid =
    !!draft &&
    typeof draft.savedAt === "number" &&
    now - draft.savedAt >= 0 &&
    now - draft.savedAt <= BOOKING_DRAFT_TTL_MS &&
    draft.userId === userId;
  if (!valid) {
    clearBookingDraft();
    return null;
  }
  if (draft!.providerId !== providerId) return null;

  clearBookingDraft();
  return draft;
}

export function clearBookingDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
