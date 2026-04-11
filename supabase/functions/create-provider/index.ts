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

    return new Response(
      JSON.stringify({ provider: providerProfile, user_id: userId }),
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