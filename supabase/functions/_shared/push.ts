// _shared/push.ts — server-side Web Push to every subscription one user has.
//
// The webpush loop from notify-user, lifted into a module so a cron-driven
// function can push to a CUSTOMER without a caller JWT. notify-user and
// send-push are deliberately NOT changed to use it: both are live and ship on
// their own.
//
// Delivery only. It never writes a notifications (bell) row — the caller owns
// that, exactly as send-push leaves the bell to BookAppointment.
//
// The payload is what public/sw-push.js reads: { title, body, url }. The
// service worker opens `url` when the notification is tapped.
//
// LOGGING: never logs key material, an endpoint URL or a payload. Endpoints
// appear as their host only (fcm.googleapis.com, web.push.apple.com, …).

import * as webpush from "jsr:@negrel/webpush@0.5.0";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface PushResult {
  /** Subscriptions found for the user. */
  attempted: number;
  sent: number;
  failed: number;
  /** Subscriptions deleted because the push service said they are gone. */
  pruned: number;
  /** Set when nothing was attempted, naming why. */
  skipped?: "NO_VAPID_KEYS" | "NO_SUBSCRIPTIONS" | "SUBSCRIPTIONS_QUERY_FAILED";
}

// The minimal surface of a service-role supabase-js client this module uses.
// Structural on purpose, so callers are not tied to one supabase-js version.
// deno-lint-ignore no-explicit-any
type AdminLike = { from: (table: string) => any };

const CONTACT = "mailto:push@nowbook.lovable.app"; // same as notify-user / send-push

// One ApplicationServer per Edge Function instance, rebuilt only if the keys
// change. Importing VAPID keys is the expensive step; a dispatch run may push
// to many customers.
let cached: { keysJson: string; server: Promise<webpush.ApplicationServer> } | null = null;

function applicationServer(keysJson: string): Promise<webpush.ApplicationServer> {
  if (cached && cached.keysJson === keysJson) return cached.server;
  const server = (async () => {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(keysJson));
    return await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys });
  })();
  // A failed import must not be cached, or every later call would rethrow it.
  server.catch(() => {
    if (cached?.server === server) cached = null;
  });
  cached = { keysJson, server };
  return server;
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(unparseable)";
  }
}

/**
 * Pushes `message` to every subscription of `userId`.
 *
 * Never throws for a delivery problem: a failed push is a count in the result,
 * and a subscription the push service reports as gone (404/410) is deleted,
 * as notify-user does. It throws only if the VAPID keys are present but
 * unusable — a configuration error the caller should log once and survive.
 *
 * `ttlSeconds` is how long the push service may hold the message for an
 * offline device. Callers announcing something perishable should keep it short.
 */
export async function sendPushToUser(
  admin: AdminLike,
  userId: string,
  message: PushMessage,
  options: { ttlSeconds?: number } = {},
): Promise<PushResult> {
  const result: PushResult = { attempted: 0, sent: 0, failed: 0, pruned: 0 };

  const keysJson = Deno.env.get("VAPID_KEYS");
  if (!keysJson) {
    console.warn("push: VAPID_KEYS is not configured — push skipped");
    return { ...result, skipped: "NO_VAPID_KEYS" };
  }

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("push: push_subscriptions query failed", { user_id: userId, reason: error.message });
    return { ...result, skipped: "SUBSCRIPTIONS_QUERY_FAILED" };
  }
  if (!subscriptions?.length) return { ...result, skipped: "NO_SUBSCRIPTIONS" };

  const server = await applicationServer(keysJson);
  const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url });
  result.attempted = subscriptions.length;

  await Promise.all(
    subscriptions.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        const subscriber = server.subscribe({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        });
        await subscriber.pushTextMessage(payload, {
          ttl: options.ttlSeconds ?? 86400,
          urgency: webpush.Urgency.High,
        });
        result.sent += 1;
      } catch (err) {
        result.failed += 1;
        const status = err instanceof webpush.PushMessageError ? err.response?.status : undefined;
        console.warn("push: delivery failed", {
          subscription_id: sub.id,
          host: endpointHost(sub.endpoint),
          status: status ?? null,
          reason: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof webpush.PushMessageError && err.isGone()) {
          const { error: deleteError } = await admin.from("push_subscriptions").delete().eq("id", sub.id);
          if (!deleteError) result.pruned += 1;
        }
      }
    }),
  );

  return result;
}
