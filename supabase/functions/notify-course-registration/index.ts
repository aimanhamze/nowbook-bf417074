// notify-course-registration — Web Push for course registration events.
//
// POST { registration_id, event } with the caller's JWT (verify_jwt = true).
// All rules live in handler.ts; this file only wires the real dependencies:
//   * the caller's id from the JWT (auth.getUser),
//   * service-role reads of the registration, its branch owner and the
//     notifications row the registration RPC wrote,
//   * the course_push_log claim (at most one push per registration + event),
//   * delivery through _shared/push.ts (never writes a notifications row).
//
// Logs never contain a title, body, endpoint or key material.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { sendPushToUser } from "../_shared/push.ts";
import { handleNotify, type Deps, type RegistrationFacts } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const deps: Deps = {
      async getUserId(token) {
        const { data, error } = await userClient.auth.getUser(token);
        return error || !data?.user ? null : data.user.id;
      },
      async loadRegistration(id) {
        const { data: reg, error } = await admin
          .from("course_registrations")
          .select("id, user_id, provider_id, status, cancelled_by, created_at, updated_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(`registration read failed: ${error.message}`);
        if (!reg) return null;
        const { data: branch, error: branchError } = await admin
          .from("provider_profiles")
          .select("user_id")
          .eq("id", reg.provider_id)
          .maybeSingle();
        if (branchError) throw new Error(`branch read failed: ${branchError.message}`);
        const facts: RegistrationFacts = {
          id: reg.id,
          user_id: reg.user_id,
          status: reg.status,
          cancelled_by: reg.cancelled_by,
          created_at: reg.created_at,
          updated_at: reg.updated_at,
          owner_id: branch?.user_id ?? null,
        };
        return facts;
      },
      async findNotification(userId, type, createdAt) {
        const { data, error } = await admin
          .from("notifications")
          .select("id, title, body, url")
          .eq("user_id", userId)
          .eq("type", type)
          .eq("created_at", createdAt)
          .order("id")
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`notification read failed: ${error.message}`);
        return data;
      },
      async claim(registrationId, event, notificationId) {
        const { data, error } = await admin
          .from("course_push_log")
          .upsert(
            { registration_id: registrationId, event, notification_id: notificationId },
            { onConflict: "registration_id,event", ignoreDuplicates: true },
          )
          .select("registration_id");
        if (error) throw new Error(`claim failed: ${error.message}`);
        return (data?.length ?? 0) > 0;
      },
      push: (userId, message) => sendPushToUser(admin, userId, message),
      now: () => Date.now(),
    };

    const result = await handleNotify({ authorization: req.headers.get("Authorization"), body }, deps);
    const parsed = body as { registration_id?: unknown; event?: unknown } | null;
    console.log("[notify-course-registration]", JSON.stringify({
      registration_id: typeof parsed?.registration_id === "string" ? parsed.registration_id : null,
      event: typeof parsed?.event === "string" ? parsed.event : null,
      status: result.status,
      outcome: result.body.error ?? (result.body.duplicate ? "duplicate" : `sent=${result.body.sent}`),
    }));
    return json(result.status, result.body);
  } catch (err) {
    console.error("[notify-course-registration] error:", err instanceof Error ? err.message : String(err));
    return json(500, { error: "INTERNAL" });
  }
});
