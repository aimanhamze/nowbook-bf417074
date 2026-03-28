import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function b64urlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toExportedVapidKeys(vapidPublicKey: string, vapidPrivateKey: string) {
  const pubBytes = b64urlDecode(vapidPublicKey);

  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error("Invalid VAPID public key format. Expected uncompressed P-256 key (65 bytes)");
  }

  const x = b64urlEncode(pubBytes.slice(1, 33));
  const y = b64urlEncode(pubBytes.slice(33, 65));

  return {
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      key_ops: ["verify"],
      ext: true,
    },
    privateKey: {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d: vapidPrivateKey,
      key_ops: ["sign"],
      ext: true,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { provider_id, title, body, url } = await req.json();

    if (!provider_id || !title) {
      return new Response(
        JSON.stringify({ error: "provider_id and title are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: providerProfile } = await supabase
      .from("provider_profiles")
      .select("user_id")
      .eq("id", provider_id)
      .single();

    if (!providerProfile) {
      return new Response(JSON.stringify({ error: "Provider not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", providerProfile.user_id);

    if (!subscriptions?.length) {
      return new Response(JSON.stringify({ message: "No subscriptions found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const exportedVapidKeys = toExportedVapidKeys(vapidPublicKey, vapidPrivateKey);
    const vapidKeys = await webpush.importVapidKeys(exportedVapidKeys);
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
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          });

          await subscriber.pushTextMessage(payload, {
            ttl: 86400,
            urgency: webpush.Urgency.High,
          });

          return {
            subscription_id: sub.id,
            status: 201,
            ok: true,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // Remove expired subscriptions when possible
          if (message.includes("410") || message.toLowerCase().includes("gone")) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }

          return {
            subscription_id: sub.id,
            status: 500,
            ok: false,
            error: message,
          };
        }
      })
    );

    return new Response(JSON.stringify({ sent: results.length, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
