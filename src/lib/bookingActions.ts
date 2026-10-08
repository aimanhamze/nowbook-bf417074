import type { Tables } from "@/integrations/supabase/types";
import type { Provider } from "@/lib/mock-data";

// Fallback cutoff (hours) when a booking's provider can't be resolved (e.g. the
// provider went invisible). Matches the column default; real cutoff comes from
// each booking's OWN provider (provider_profiles.cancellation_notice_hours).
export const DEFAULT_CANCELLATION_HOURS = 5;

// Combine the stored text date + time into a single Date. booking_date is an
// ISO date ("2026-06-25"), booking_time is "HH:MM" — both stored as text.
export const bookingDateTime = (b: Pick<Tables<"bookings">, "booking_date" | "booking_time">) =>
  new Date(`${b.booking_date}T${b.booking_time}:00`);

/** A row whose user_id isn't the current user is a provider-created walk-in
 *  linked to them by phone: view-only (RLS blocks update/delete). */
export const isLinkedWalkin = (booking: Tables<"bookings">, userId: string) =>
  booking.user_id !== userId;

export interface BookingActionState {
  isPast: boolean;
  /** Still ahead AND confirmed or pending. */
  isActive: boolean;
  canCancel: boolean;
  /** Inside the provider's cutoff: no self-cancel, contact them instead. */
  canCallToCancel: boolean;
  canReschedule: boolean;
}

/**
 * Which customer actions a booking offers right now. Shared by the bookings
 * list and the provider-page appointment card so the two can never disagree.
 * The database re-checks every one of these; this only decides what to show.
 */
export function bookingActionState({
  booking,
  linkedWalkin,
  cancellationNoticeHours,
  provider,
  now = new Date(),
}: {
  booking: Tables<"bookings">;
  linkedWalkin: boolean;
  cancellationNoticeHours: number;
  provider: Provider | null;
  now?: Date;
}): BookingActionState {
  const when = bookingDateTime(booking);
  const isPast = when < now;
  const hoursUntilBooking = (when.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isActive = !isPast && (booking.status === "confirmed" || booking.status === "pending");
  // Cutoff comes from THIS booking's provider. 0 = always cancellable while
  // active (no late-cancel block / call-to-cancel state).
  // Linked walk-ins are view-only for the customer: the UPDATE RLS policy is
  // user_id-only, so a self-cancel would fail. Suppress ALL cancel affordances
  // (self-cancel AND the call-to-cancel window notice) for them.
  const canCancel = !linkedWalkin && isActive && (cancellationNoticeHours <= 0 || hoursUntilBooking > cancellationNoticeHours);
  const canCallToCancel = !linkedWalkin && isActive && cancellationNoticeHours > 0 && hoursUntilBooking <= cancellationNoticeHours;
  // Self-reschedule: the provider opted in, and the booking could be cancelled
  // right now (same cutoff -- canCancel). Confirmed only, and never a class:
  // classes run at fixed times. trg_enforce_customer_reschedule re-checks all
  // of this in the DB; this gate only decides whether to show the button.
  const canReschedule =
    canCancel &&
    booking.status === "confirmed" &&
    !booking.class_schedule_id &&
    !!provider?.allowCustomerReschedule &&
    provider.category !== "fitness_studio";
  return { isPast, isActive, canCancel, canCallToCancel, canReschedule };
}
