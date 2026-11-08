import { supabase } from "@/integrations/supabase/client";
import { buildCoursePush, sendPushBody, type CoursePushContext, type CoursePushEvent } from "@/lib/academyPush";

/**
 * Fire-and-forget push for a course event, called AFTER the RPC succeeded.
 *
 * Never throws and is never awaited by the caller: the registration change is
 * already committed (and its in-app row written by the RPC), so a slow or
 * failing push must not fail the action or show an error — same contract as
 * the booking pushes in BookAppointment / useCancelBooking. Errors are logged.
 *
 * Provider-bound events go through `send-push`, the delivery-only function the
 * booking flow uses (it writes no notifications row, so nothing is duplicated).
 *
 * Customer-bound events (confirmed / rejected / cancelled by provider) are NOT
 * delivered yet: the only user-addressed function, `notify-user`, also inserts
 * a notifications row (a duplicate of the RPC's) and accepts any title/body for
 * any user_id. The transport is pending a decision — see the Phase 4 report.
 */
export function deliverCoursePush(event: CoursePushEvent, ctx: CoursePushContext): void {
  const push = buildCoursePush(event, ctx);
  void (async () => {
    try {
      if (push.target.kind === "provider") {
        const { error } = await supabase.functions.invoke("send-push", {
          body: sendPushBody(push as Parameters<typeof sendPushBody>[0]),
        });
        if (error) console.warn(`send-push (${push.type}) failed:`, error.message);
        return;
      }
      // Customer-bound: transport not wired yet (see header). The in-app row
      // from the RPC is the customer's notification for now.
      console.info(`[course-push] ${push.type} to customer not sent: customer push transport pending`);
    } catch (err) {
      console.warn(`course push (${push.type}) threw:`, err);
    }
  })();
}
