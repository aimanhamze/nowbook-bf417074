import { supabase } from "@/integrations/supabase/client";

/** A course registration event, as notify-course-registration names it. */
export type CoursePushEvent =
  | "new"
  | "confirmed"
  | "rejected"
  | "cancelled_by_customer"
  | "cancelled_by_provider";

/**
 * Fire-and-forget push for a course event, called AFTER the RPC succeeded.
 *
 * Every course push — to the branch owner or to the customer — goes through
 * the `notify-course-registration` Edge Function with ONLY the registration id
 * and the event. The function checks the caller and the registration's state,
 * then pushes exactly the in-app row the RPC already wrote (it never writes a
 * notifications row itself, and pushes at most once per registration + event).
 * Course pushes never use notify-user or send-push.
 *
 * Never throws and is never awaited by the caller: the registration change is
 * already committed, so a slow or failing push must not fail the action or
 * show an error — same contract as the booking pushes. Errors are logged.
 */
export function deliverCoursePush(event: CoursePushEvent, registrationId: string): void {
  void (async () => {
    try {
      const { error } = await supabase.functions.invoke("notify-course-registration", {
        body: { registration_id: registrationId, event },
      });
      if (error) console.warn(`notify-course-registration (${event}) failed:`, error.message);
    } catch (err) {
      console.warn(`course push (${event}) threw:`, err);
    }
  })();
}
