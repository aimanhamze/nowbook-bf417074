import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useLang } from "@/contexts/LangContext";
import { useLiveSessionGuard } from "@/hooks/useLiveSessionGuard";
import { SessionHandledError, isUnauthenticatedWriteError } from "@/lib/liveSession";

/**
 * Customer self-cancel — the ONE implementation, used by the bookings list and
 * the provider-page appointment card. Every query under ["bookings", ...] is
 * refreshed afterwards, which covers both.
 *
 * `serviceName` is only used in the provider's push text.
 */
export function useCancelBooking() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { ensureLiveSession, endDeadSession } = useLiveSessionGuard();

  return useMutation({
    mutationFn: async ({ booking, serviceName }: { booking: Tables<"bookings">; serviceName: string }) => {
      // Without a usable token supabase-js sends this UPDATE as anon, RLS
      // filters it to zero rows, and PostgREST reports success. Check first.
      if (!(await ensureLiveSession())) throw new SessionHandledError();

      // .select("id") so we can SEE whether a row changed: a zero-row update
      // is not an error to PostgREST, and must never reach "cancelled".
      const { data: cancelled, error, status } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id)
        .select("id");
      if (error) {
        if (isUnauthenticatedWriteError(error, status)) {
          await endDeadSession();
          throw new SessionHandledError();
        }
        throw error;
      }
      if (!cancelled || cancelled.length === 0) throw new Error("CANCEL_NO_ROWS");

      // Save cancellation notification for the customer
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("notifications").insert({
          user_id: user.id,
          title: "ביטלת תור ❌",
          body: `התור בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל`,
          url: `/provider/${booking.provider_id}`,
          type: "booking_cancelled",
        });
        queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }

      // Notify provider about customer cancellation
      const { data: providerProfile } = await supabase
        .from("provider_profiles")
        .select("user_id")
        .eq("id", booking.provider_id)
        .single();
      if (providerProfile?.user_id) {
        await supabase.from("notifications").insert({
          user_id: providerProfile.user_id,
          title: "תור בוטל ❌",
          body: `לקוח ביטל תור בתאריך ${booking.booking_date} בשעה ${booking.booking_time}`,
          url: "/dashboard",
          type: "booking_cancelled",
        });
      }

      // Push the provider as well — additive to the bell row above, which is
      // unchanged. Deliberately NOT awaited: the cancellation is already
      // committed at this point, so a slow or failing push must never fail the
      // mutation or surface an error to the customer. Errors are logged only.
      // send-push resolves provider_profiles.id -> user_id itself, so this does
      // not depend on the providerProfile lookup above.
      void (async () => {
        try {
          const { data: customerProfile } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", user?.id ?? "")
            .maybeSingle();
          const customerName = customerProfile?.display_name || "לקוח";

          const { error: pushError } = await supabase.functions.invoke("send-push", {
            body: {
              provider_id: booking.provider_id,
              title: "בוטל תור ❌",
              body: `${customerName} ביטל/ה את התור ל-${serviceName} בתאריך ${booking.booking_date} בשעה ${booking.booking_time}`,
              url: "/calendar",
              type: "booking_cancelled",
            },
          });
          if (pushError) {
            console.warn("send-push (cancellation) failed:", pushError.message);
          }
        } catch (err) {
          console.warn("send-push (cancellation) threw:", err);
        }
      })();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(t("bookingCancelled"));
    },
    onError: (err) => {
      if (err instanceof SessionHandledError) return;
      // The list may be stale (e.g. the booking changed elsewhere) — refresh it
      // so what the customer sees matches the database.
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.error(t("errorCancelBooking"));
    },
  });
}
