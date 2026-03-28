import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Web Push crypto helpers for VAPID
async function generateVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
) {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: expiry,
    sub: "mailto:push@nowbook.lovable.app",
  };

  const b64url = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const encodeJson = (obj: unknown) =>
    b64url(new TextEncoder().encode(JSON.stringify(obj)));

  const unsignedToken = `${encodeJson(header)}.${encodeJson(payload)}`;

  // Import private key
  const padding = "=".repeat((4 - (vapidPrivateKey.length % 4)) % 4);
  const rawKey = Uint8Array.from(
    atob(vapidPrivateKey.replace(/-/g, "+").replace(/_/g, "/") + padding),
    (c) => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Normally we'd need the full JWK. For simplicity, use a direct fetch approach.
  // Since Web Push crypto is complex, we'll use web-push compatible approach.
  // Let's use a simpler method - just send without encryption for now and use
  // the subscription's built-in encryption.

  return { vapidPublicKey };
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

    // Send to each subscription using web-push protocol
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        // Build VAPID JWT
        const audience = new URL(sub.endpoint).origin;
        const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

        const jwtHeader = btoa(JSON.stringify({ typ: "JWT", alg: "ES256" }))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const jwtPayload = btoa(JSON.stringify({
          aud: audience,
          exp: expiry,
          sub: "mailto:push@nowbook.lovable.app",
        })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

        const unsignedToken = `${jwtHeader}.${jwtPayload}`;

        // Import VAPID private key for signing
        const privKeyPadding = "=".repeat((4 - (vapidPrivateKey.length % 4)) % 4);
        const privKeyBytes = Uint8Array.from(
          atob(vapidPrivateKey.replace(/-/g, "+").replace(/_/g, "/") + privKeyPadding),
          (c) => c.charCodeAt(0)
        );

        // Create JWK from raw private key  
        const pubKeyPadding = "=".repeat((4 - (vapidPublicKey.length % 4)) % 4);
        const pubKeyBytes = Uint8Array.from(
          atob(vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/") + pubKeyPadding),
          (c) => c.charCodeAt(0)
        );

        // The public key is 65 bytes (uncompressed), x and y are 32 bytes each
        const x = pubKeyBytes.slice(1, 33);
        const y = pubKeyBytes.slice(33, 65);

        const jwk = {
          kty: "EC",
          crv: "P-256",
          x: btoa(String.fromCharCode(...x)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
          y: btoa(String.fromCharCode(...y)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
          d: btoa(String.fromCharCode(...privKeyBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
        };

        const key = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"]
        );

        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          new TextEncoder().encode(unsignedToken)
        );

        const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

        const jwt = `${unsignedToken}.${sig}`;

        // Encrypt payload using subscription keys (aes128gcm)
        // For simplicity, send unencrypted with proper VAPID auth
        // The browser requires encrypted payloads, so we need to implement RFC 8291
        
        // Import subscription public key
        const subPubPadding = "=".repeat((4 - (sub.p256dh.length % 4)) % 4);
        const subPubBytes = Uint8Array.from(
          atob(sub.p256dh.replace(/-/g, "+").replace(/_/g, "/") + subPubPadding),
          (c) => c.charCodeAt(0)
        );

        const subAuthPadding = "=".repeat((4 - (sub.auth.length % 4)) % 4);
        const subAuthBytes = Uint8Array.from(
          atob(sub.auth.replace(/-/g, "+").replace(/_/g, "/") + subAuthPadding),
          (c) => c.charCodeAt(0)
        );

        // Generate local ECDH key pair for content encryption
        const localKeyPair = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits"]
        );

        // Import subscription public key for ECDH
        const subscriberKey = await crypto.subtle.importKey(
          "raw",
          subPubBytes,
          { name: "ECDH", namedCurve: "P-256" },
          false,
          []
        );

        // Derive shared secret
        const sharedSecret = await crypto.subtle.deriveBits(
          { name: "ECDH", public: subscriberKey },
          localKeyPair.privateKey,
          256
        );

        // Export local public key
        const localPubKey = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
        const localPubKeyBytes = new Uint8Array(localPubKey);

        // RFC 8291 key derivation
        const encoder = new TextEncoder();

        // PRK = HKDF-Extract(auth_secret, ecdh_secret)
        const authInfo = encoder.encode("Content-Encoding: auth\0");
        const ikmKey = await crypto.subtle.importKey("raw", new Uint8Array(sharedSecret), { name: "HKDF" }, false, ["deriveBits"]);
        
        // IKM for HKDF
        const authKey = await crypto.subtle.importKey("raw", subAuthBytes, { name: "HKDF" }, false, ["deriveBits"]);
        
        // Simplified: Use HKDF with auth as salt and shared secret as IKM
        const prkKey = await crypto.subtle.importKey("raw", new Uint8Array(sharedSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const prk = new Uint8Array(await crypto.subtle.sign("HMAC", 
          await crypto.subtle.importKey("raw", subAuthBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
          new Uint8Array(sharedSecret)
        ));

        // Key info for aes128gcm
        const keyInfoBuf = new Uint8Array([
          ...encoder.encode("WebPush: info\0"),
          ...subPubBytes,
          ...localPubKeyBytes,
        ]);

        // Derive CEK and nonce using HKDF
        const prkImport = await crypto.subtle.importKey("raw", prk, { name: "HKDF" }, false, ["deriveBits"]);
        
        const cekInfo = new Uint8Array([
          ...encoder.encode("Content-Encoding: aes128gcm\0"),
        ]);
        const nonceInfo = new Uint8Array([
          ...encoder.encode("Content-Encoding: nonce\0"),
        ]);

        // Derive IKM from PRK
        const ikm = new Uint8Array(
          await crypto.subtle.deriveBits(
            { name: "HKDF", hash: "SHA-256", salt: subAuthBytes, info: keyInfoBuf },
            await crypto.subtle.importKey("raw", new Uint8Array(sharedSecret), { name: "HKDF" }, false, ["deriveBits"]),
            256
          )
        );

        const ikmKey2 = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);

        // salt for aes128gcm header
        const salt = crypto.getRandomValues(new Uint8Array(16));

        const cekBits = await crypto.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
          ikmKey2,
          128
        );
        const nonceBits = await crypto.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
          ikmKey2,
          96
        );

        // Encrypt with AES-128-GCM
        const cek = await crypto.subtle.importKey("raw", new Uint8Array(cekBits), { name: "AES-GCM" }, false, ["encrypt"]);
        
        // Add padding delimiter
        const payloadBytes = encoder.encode(payload);
        const paddedPayload = new Uint8Array(payloadBytes.length + 1);
        paddedPayload.set(payloadBytes);
        paddedPayload[payloadBytes.length] = 2; // delimiter

        const encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: new Uint8Array(nonceBits) },
          cek,
          paddedPayload
        );

        // Build aes128gcm body: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted
        const rs = 4096;
        const rsBytes = new Uint8Array(4);
        new DataView(rsBytes.buffer).setUint32(0, rs);

        const body_parts = new Uint8Array(
          16 + 4 + 1 + localPubKeyBytes.length + new Uint8Array(encrypted).length
        );
        body_parts.set(salt, 0);
        body_parts.set(rsBytes, 16);
        body_parts[20] = localPubKeyBytes.length;
        body_parts.set(localPubKeyBytes, 21);
        body_parts.set(new Uint8Array(encrypted), 21 + localPubKeyBytes.length);

        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
            TTL: "86400",
            Urgency: "high",
          },
          body: body_parts,
        });

        if (response.status === 410 || response.status === 404) {
          // Subscription expired, remove it
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
        }

        return { status: response.status, endpoint: sub.endpoint };
      })
    );

    return new Response(
      JSON.stringify({ sent: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Send push error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
