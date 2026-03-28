import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

function base64UrlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createVapidJwt(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<{ authorization: string; cryptoKey: string }> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  // Build JWT header and payload
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: expiry,
        sub: "mailto:push@nowbook.lovable.app",
      })
    )
  );

  const unsignedToken = `${header}.${payload}`;

  // Import VAPID keys as JWK
  const pubKeyBytes = base64UrlDecode(vapidPublicKey);
  const privKeyBytes = base64UrlDecode(vapidPrivateKey);

  const x = pubKeyBytes.slice(1, 33);
  const y = pubKeyBytes.slice(33, 65);

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(privKeyBytes),
  };

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format (each 32 bytes)
  const sigBytes = new Uint8Array(signatureBuffer);
  let r: Uint8Array, s: Uint8Array;

  if (sigBytes.length === 64) {
    // Already raw format
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  } else {
    // It's raw from WebCrypto (should be 64 bytes for P-256)
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }

  const sig = base64UrlEncode(new Uint8Array([...r, ...s]));
  const jwt = `${unsignedToken}.${sig}`;

  return {
    authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
    cryptoKey: vapidPublicKey,
  };
}

async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<{ encrypted: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const payloadBytes = new TextEncoder().encode(payload);

  // Decode subscription keys
  const subscriberPubBytes = base64UrlDecode(p256dhKey);
  const authBytes = base64UrlDecode(authSecret);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Export local public key
  const localPubKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", localKeyPair.publicKey)
  );

  // Import subscriber public key
  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    subscriberPubBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Derive shared secret via ECDH
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberKey },
      localKeyPair.privateKey,
      256
    )
  );

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 key derivation
  // Step 1: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || client_pub || server_pub, 32)
  const keyInfoBuf = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...subscriberPubBytes,
    ...localPubKeyRaw,
  ]);

  const ikmKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: authBytes, info: keyInfoBuf },
      ikmKey,
      256
    )
  );

  // Step 2: Derive CEK and nonce from IKM using salt
  const ikmKey2 = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");

  const cekBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
      ikmKey2,
      128
    )
  );

  const nonceBits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
      ikmKey2,
      96
    )
  );

  // Encrypt with AES-128-GCM
  const cek = await crypto.subtle.importKey(
    "raw",
    cekBits,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Add padding delimiter (RFC 8291: payload + delimiter byte 0x02)
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2;

  const encryptedData = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonceBits },
      cek,
      paddedPayload
    )
  );

  // Build aes128gcm content: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs);

  const result = new Uint8Array(
    16 + 4 + 1 + localPubKeyRaw.length + encryptedData.length
  );
  result.set(salt, 0);
  result.set(rsBytes, 16);
  result[20] = localPubKeyRaw.length;
  result.set(localPubKeyRaw, 21);
  result.set(encryptedData, 21 + localPubKeyRaw.length);

  return { encrypted: result, salt, localPublicKey: localPubKeyRaw };
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;

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

    // Get push subscriptions for provider's user
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", providerProfile.user_id);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No subscriptions found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.stringify({ title, body, url: url || "/dashboard" });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        // Create VAPID authorization
        const vapid = await createVapidJwt(sub.endpoint, vapidPublicKey, vapidPrivateKey);

        // Encrypt the payload
        const { encrypted } = await encryptPayload(payload, sub.p256dh, sub.auth);

        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            Authorization: vapid.authorization,
            TTL: "86400",
            Urgency: "high",
          },
          body: encrypted,
        });

        const responseText = await response.text();

        if (response.status === 410 || response.status === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }

        return {
          status: response.status,
          statusText: response.statusText,
          body: responseText,
          endpoint: sub.endpoint.substring(0, 50) + "...",
        };
      })
    );

    return new Response(
      JSON.stringify({ sent: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Send push error:", err);
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
