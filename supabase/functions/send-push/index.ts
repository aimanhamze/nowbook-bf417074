import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // `type` is intentionally not destructured — it was only used by the
    // notifications insert this function no longer performs.
    const { provider_id, title, body, url } = await req.json();

    if (!provider_id || !title) {
      return new Response(
        JSON.stringify({ error: "provider_id and title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get provider's user_id
    const { data: providerProfile } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .eq("id", provider_id)
      .single();

    if (!providerProfile) {
      return new Response(
        JSON.stringify({ error: "Provider not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // NOTE: this function no longer writes a `notifications` row.
    // The caller (BookAppointment.tsx) owns the in-app notification;
    // send-push is delivery-only. See deploy notes.

    // Try sending push
    const vapidKeysJson = Deno.env.get("VAPID_KEYS");
    console.log("[send-push] target user_id:", providerProfile.user_id);
    console.log("[send-push] VAPID_KEYS present:", !!vapidKeysJson);

    const { data: subscriptions, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", providerProfile.user_id);

    if (subsError) {
      console.error("[send-push] push_subscriptions query error:", subsError.message);
    }
    console.log("[send-push] subscriptions found:", subscriptions?.length ?? 0);

    if (!subscriptions?.length) {
      console.log("[send-push] nothing to send — no subscriptions for this user");
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, message: "No push subscriptions found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let vapidKeys;
    try {
      // Never log the parsed key material — only the public key + shape.
      const parsed = JSON.parse(vapidKeysJson ?? "");
      console.log(
        "[send-push] VAPID parsed OK — publicKey:",
        parsed?.publicKey ?? "(missing)",
        "| privateKey present:",
        !!parsed?.privateKey
      );
      vapidKeys = await webpush.importVapidKeys(parsed);
      console.log("[send-push] VAPID keys imported OK");
    } catch (vapidErr) {
      const message = vapidErr instanceof Error ? vapidErr.message : String(vapidErr);
      console.error("[send-push] VAPID parse/import FAILED:", message);
      throw vapidErr;
    }

    const appServer = await webpush.ApplicationServer.new({
      contactInformation: "mailto:push@nowbook.lovable.app",
      vapidKeys,
    });

    const payload = JSON.stringify({
      title,
      body: body || "יש לך הזמנה חדשה",
      url: url || "/dashboard",
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const subscriber = appServer.subscribe({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          });
          await subscriber.pushTextMessage(payload, {
            ttl: 86400,
            urgency: webpush.Urgency.High,
          });
          console.log("[send-push] sent OK to subscription", sub.id);
          return { subscription_id: sub.id, ok: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // Pull the HTTP status (and body, if still readable) off the push
          // service response — this is what tells us WHY delivery failed.
          let status: number | undefined;
          let responseBody: string | undefined;
          if (err instanceof webpush.PushMessageError) {
            status = err.response?.status;
            try {
              responseBody = await err.response?.clone().text();
            } catch {
              // body already consumed / not readable — ignore
            }
          }

          console.error(
            "[send-push] SEND FAILED — subscription:", sub.id,
            "| endpoint host:", (() => { try { return new URL(sub.endpoint).host; } catch { return "(unparseable)"; } })(),
            "| status:", status ?? "(none)",
            "| message:", message,
            "| body:", responseBody ?? "(none)"
          );
          console.error("[send-push] raw error:", err);

          if (err instanceof webpush.PushMessageError && err.isGone()) {
            console.log("[send-push] subscription gone (404/410) — pruning", sub.id);
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
          return { subscription_id: sub.id, ok: false, status, error: message };
        }
      })
    );

    const settled = results.map((r) =>
      r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason) }
    );
    const sent = settled.filter((r) => r.ok).length;
    const failed = settled.length - sent;

    console.log("[send-push] summary:", JSON.stringify({ sent, failed, results: settled }));

    return new Response(
      JSON.stringify({ sent, failed, results: settled }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Send push error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
