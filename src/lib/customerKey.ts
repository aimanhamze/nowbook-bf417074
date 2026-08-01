// ─────────────────────────────────────────────────────────────────────────────
// THE canonical customer identity for a booking row.
//
// This module is the SINGLE source of truth for "are these two bookings the
// same customer?". Before it existed there were two divergent implementations
// (useProviderStats and useProviderCustomers) that returned DIFFERENT unique-
// customer counts for the same provider. Do not add a third — import from here.
//
// Identity precedence:
//   1. ACCOUNT — user_id, else linked_user_id  → "u:<uuid>"
//      linked_user_id is set by the link_walkin_to_account BEFORE INSERT trigger
//      (supabase/migrations/20260714000002) when a provider-created walk-in's
//      phone unambiguously matches exactly one registered profile. Folding it in
//      here is what makes a linked walk-in and that same person's own app
//      booking collapse to ONE customer instead of two.
//   2. PHONE — digit-normalized walk-in phone  → "p:<9 digits>"
//   3. ROW    — the booking id                 → "w:<uuid>"
//      Defensive only: every walk-in in live data has a phone. Keying on the row
//      keeps a detail-less walk-in visible as its own customer rather than
//      silently collapsing every such booking into one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Digits kept when comparing phone numbers.
 *
 * Israeli mobiles are 10 digits nationally (05X-XXXXXXX) and 12 in E.164
 * (+972-5X-XXXXXXX). Comparing the LAST 9 collapses those two forms onto the
 * same key — which is the whole point, since providers type both.
 *
 * It is also the floor for a usable phone: the DB trigger rejects anything
 * shorter than 9 digits (`IF length(d) < 9 THEN RETURN NEW`) so a stray
 * fragment can never match an account. We mirror that so a junk value falls
 * through to the row-id fallback instead of becoming a key that collides.
 */
export const PHONE_KEY_DIGITS = 9;

/** The fields customerKey() reads. Structural, so any booking-shaped row fits. */
export interface CustomerKeyable {
  id: string;
  user_id?: string | null;
  /** Set by the link_walkin_to_account trigger on matched walk-ins. */
  linked_user_id?: string | null;
  customer_phone?: string | null;
}

/**
 * Digit-normalize a phone number for identity comparison.
 *
 * Strips every non-digit (matching the DB trigger's `regexp_replace(phone,
 * '\D', '', 'g')`) and returns the last PHONE_KEY_DIGITS digits.
 *
 * Returns null when there is nothing trustworthy to compare — missing, empty,
 * or fewer than PHONE_KEY_DIGITS digits after stripping.
 *
 * NOTE — deliberately WIDER than the DB trigger. The trigger compares the FULL
 * digit string for equality, so it will not link "0501234567" to a profile
 * stored as "+972501234567". This function treats them as the same person.
 * That asymmetry is intentional: linking writes a row and must be conservative;
 * de-duplicating a read-only count should not show one human twice.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < PHONE_KEY_DIGITS) return null;
  return digits.slice(-PHONE_KEY_DIGITS);
}

/**
 * The canonical dedupe identity for a booking. See the precedence note above.
 *
 * Always returns a non-empty string, so it is safe as a Map/Set key and as a
 * React key.
 */
export function customerKey(booking: CustomerKeyable): string {
  // user_id first: an app booking is authoritative. The trigger only ever sets
  // linked_user_id on rows where user_id IS NULL, so these never conflict —
  // but preferring user_id keeps the result deterministic regardless.
  const accountId = booking.user_id || booking.linked_user_id;
  if (accountId) return `u:${accountId}`;

  const phone = normalizePhone(booking.customer_phone);
  if (phone) return `p:${phone}`;

  return `w:${booking.id}`;
}

/**
 * Whether a customer key belongs to a registered account.
 *
 * Derived from the key rather than from a single booking row so it cannot flip
 * with row iteration order: a person with both an app booking and a linked
 * walk-in resolves to one "u:" key and is registered either way.
 */
export function isRegisteredKey(key: string): boolean {
  return key.startsWith("u:");
}
