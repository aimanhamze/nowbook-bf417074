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

export function notifyBookingConfirmed(bookingId: string): void {
  if (!bookingId) return;

  void supabase.functions
    .invoke("whatsapp-booking-confirm", { body: { booking_id: bookingId } })
    .then(({ error }) => {
      if (error) {
        console.warn("whatsapp-booking-confirm invoke failed:", error.message);
      }
    })
    .catch((err) => {
      console.warn("whatsapp-booking-confirm invoke threw:", err);
    });
}
