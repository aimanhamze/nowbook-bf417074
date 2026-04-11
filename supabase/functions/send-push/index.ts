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

    const { provider_id, title, body, url, type } = await req.json();

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

    // Save notification to DB
    await supabase.from("notifications").insert({
      user_id: providerProfile.user_id,
      title,
      body: body || "יש לך הזמנה חדשה",
      url: url || "/dashboard",
      type: type || "booking_new",
    });

    // Try sending push
    const vapidKeysJson = Deno.env.get("VAPID_KEYS")!;

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", providerProfile.user_id);

    if (!subscriptions?.length) {
      return new Response(
        JSON.stringify({ saved: true, message: "No push subscriptions found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidKeysJson));
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
          return { subscription_id: sub.id, ok: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof webpush.PushMessageError && err.isGone()) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
          return { subscription_id: sub.id, ok: false, error: message };
        }
      })
    );

    return new Response(
      JSON.stringify({ saved: true, sent: results.length, results }),
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
