// Sends a Standard-Webhooks-signed fake Send SMS hook request to send-sms-hook,
// shaped like what Supabase Auth sends (phone as digits with no '+').
//
// USAGE (from the repo root):
//   npx -y deno run --allow-net --allow-env --env-file=supabase/functions/.env \
//     supabase/scripts/send-sms-hook-fake.ts <phone> [--bad-sig] [--url=<function url>]
//
//   <phone>     e.g. 972501234567, +972501234567, 0501234567. A leading '+' is
//               stripped, as Auth does.
//   --bad-sig   sign with a random secret instead of SEND_SMS_HOOK_SECRET; the
//               function must answer 401.
//   --url       default http://localhost:8000 (the function run directly with
//               deno). For `supabase functions serve` use
//               http://127.0.0.1:54321/functions/v1/send-sms-hook
//
// Reads only SEND_SMS_HOOK_SECRET from the env file. The OTP is random and
// fake, and is never printed.
//
// ⚠ With SMS_DRY_RUN unset or false in the function's env, this sends a REAL,
// billable SMS to <phone> — via Shmor, or via Twilio for non-Shmor numbers.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const args = Deno.args;
const phoneArg = args.find((a) => !a.startsWith("--"));
const badSig = args.includes("--bad-sig");
const url = args.find((a) => a.startsWith("--url="))?.slice("--url=".length) ?? "http://localhost:8000";

if (!phoneArg) {
  console.error("usage: send-sms-hook-fake.ts <phone> [--bad-sig] [--url=<function url>]");
  Deno.exit(2);
}

const rawSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
if (!rawSecret) {
  console.error("SEND_SMS_HOOK_SECRET is not set (pass --env-file=supabase/functions/.env)");
  Deno.exit(2);
}

const secret = badSig
  ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  : rawSecret.replace("v1,whsec_", "");

const phone = phoneArg.replace(/^\+/, "");
const otp = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

const body = JSON.stringify({
  metadata: { uuid: crypto.randomUUID(), time: new Date().toISOString(), name: "send-sms", ip_address: "127.0.0.1" },
  user: {
    id: crypto.randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email: "",
    phone,
    app_metadata: { provider: "phone", providers: ["phone"] },
    user_metadata: {},
    identities: [],
    is_anonymous: false,
  },
  sms: { otp, phone },
});

const id = crypto.randomUUID();
const at = new Date();
const signature = new Webhook(secret).sign(id, at, body);

const startedAt = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
    "webhook-signature": signature,
  },
  body,
});
const text = await res.text();

console.log(`HTTP ${res.status} in ${Date.now() - startedAt} ms${badSig ? " (bad signature)" : ""}`);
console.log(text || "(empty body)");
