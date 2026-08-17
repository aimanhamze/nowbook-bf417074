/**
 * Fire-and-forget trigger for the WhatsApp booking-confirmation message.
 *
 * BEST-EFFORT BY CONTRACT: the booking is already confirmed by the time this
 * runs. The message is a side effect, so nothing here may block, delay, or fail
 * the confirmation itself — every failure path swallows and logs. Callers must
 * NOT await this in a way that gates their own success.
 *
 * The Edge Function is the authority on whether anything is actually sent. It
 * re-reads the booking, the provider's opt-in, the language and the recipient's
 * phone with the service role, and enforces the allowlist plus a DB-level
 * once-only guard. That is why this helper passes a booking id and nothing
 * else: sending message text or a phone number from the browser would let any
 * authenticated user emit arbitrary WhatsApp messages from the business number.
 *
 * Safe to call more than once for the same booking — a unique index on
 * (booking_id, message_kind) means the second call sends nothing.
 */

import { supabase } from "@/integrations/supabase/client";

/** Message kinds the Edge Function serves. Mirrors MESSAGE_KINDS there. */
type MessageKind = "booking_confirm" | "booking_cancelled";

/**
 * Awaitable form. Resolves on success AND on every failure — it never rejects,
 * so awaiting it can only ever cost time, never propagate an error into a
 * booking mutation.
 */
async function sendWhatsApp(bookingId: string, kind: MessageKind): Promise<void> {
  if (!bookingId) return;
  try {
    const { error } = await supabase.functions.invoke("whatsapp-booking-confirm", {
      body: { booking_id: bookingId, kind },
    });
    if (error) {
      console.warn(`whatsapp-booking-confirm (${kind}) invoke failed:`, error.message);
    }
  } catch (err) {
    console.warn(`whatsapp-booking-confirm (${kind}) invoke threw:`, err);
  }
}

/** Fire-and-forget: starts the send and returns immediately. */
function invokeWhatsApp(bookingId: string, kind: MessageKind): void {
  void sendWhatsApp(bookingId, kind);
}

export function notifyBookingConfirmed(bookingId: string): void {
  invokeWhatsApp(bookingId, "booking_confirm");
}

/**
 * Call ONLY from provider-initiated cancellation paths.
 *
 * The customer's own cancel path in Bookings.tsx must never call this — they
 * already know they cancelled. That is enforced twice over: this helper is not
 * wired there, AND the Edge Function refuses `booking_cancelled` from a customer
 * caller with a 403. The second half is the one that matters, because `bookings`
 * records no cancelled_by, so the database cannot tell the two cases apart.
 *
 * Also NOT called from useRejectBooking: declining a pending request is not the
 * same event as cancelling a confirmed appointment, and the cancellation
 * template would tell the customer an appointment was cancelled that they were
 * never told they had.
 */
export function notifyBookingCancelled(bookingId: string): void {
  invokeWhatsApp(bookingId, "booking_cancelled");
}

/**
 * Cancellation notices for a whole group class, sent ONE AT A TIME.
 *
 * A single provider tap cancels every participant, so a naive loop would put a
 * burst of N simultaneous SendPulse calls behind one click. The chain below
 * awaits each send before starting the next.
 *
 * It is DETACHED, not awaited: the caller returns immediately, so pacing the
 * requests never delays the cancellation or the UI. That is the whole reason
 * this is a promise chain rather than a `for await` in the caller — a plain
 * `for` loop over the fire-and-forget helper would not serialise anything, and
 * awaiting it in the mutation would hold the provider's UI for N round-trips.
 *
 * No cap: every participant needs telling, and the unique index on
 * (booking_id, message_kind) bounds it to one message each.
 */
export function notifyBookingsCancelled(bookingIds: string[]): void {
  void bookingIds.reduce<Promise<void>>(
    (chain, id) => chain.then(() => sendWhatsApp(id, "booking_cancelled")),
    Promise.resolve(),
  );
}
