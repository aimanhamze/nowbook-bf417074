import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

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

    // Verify caller is authenticated — pass token directly to getUser()
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller has admin role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, password, display_name, business_name, category, city, phone } = await req.json();

    if (!email || !password || !business_name || !category) {
      return new Response(
        JSON.stringify({ error: "email, password, business_name and category are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create auth user — trigger handle_new_user() will auto-create
    // the profiles row and a 'user' role row after this insert.
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name || business_name },
    });
    if (createError) {
      const msg = createError.message || "";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return new Response(
          JSON.stringify({ error: `האימייל ${email} כבר רשום במערכת. השתמש באימייל אחר.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw createError;
    }

    const userId = newUser.user.id;

    // Assign provider role (trigger already added 'user' role)
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert({ user_id: userId, role: "provider" });
    if (roleError) throw roleError;

    // Create provider profile
    const { data: providerProfile, error: providerError } = await adminClient
      .from("provider_profiles")
      .insert({
        user_id: userId,
        business_name: business_name.trim(),
        category,
        address: city?.trim() || "",
        phone: phone?.trim() || "",
      })
      .select()
      .single();
    if (providerError) throw providerError;

    // Seed the full weekly availability so the provider always has exactly 7
    // rows (day_of_week 0–6). provider_availability is the single source of
    // truth — every reader expects a row per day, with no fabricated defaults.
    // Defaults match the 20260529 backfill migration 1:1:
    //   dow 0–4 (Sun–Thu) → open  09:00–17:00
    //   dow 5–6 (Fri–Sat) → closed 09:00–17:00
    const availabilityRows = Array.from({ length: 7 }, (_, dow) => ({
      provider_id: providerProfile.id,
      day_of_week: dow,
      start_time: "09:00",
      end_time: "17:00",
      is_available: dow >= 0 && dow <= 4,
    }));

    // Log-and-continue: the auth user, role and profile are already committed,
    // so a failed seed must not fail the whole creation (that would orphan the
    // account). A provider with a profile but no hours is recoverable — the
    // idempotent backfill migration re-seeds any missing rows. We surface the
    // failure in the response so the caller can warn if it wants to.
    const { error: availabilityError } = await adminClient
      .from("provider_availability")
      .insert(availabilityRows);
    if (availabilityError) {
      console.error("create-provider: availability seed failed:", availabilityError.message);
    }

    return new Response(
      JSON.stringify({
        provider: providerProfile,
        user_id: userId,
        availability_seeded: !availabilityError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-provider error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});