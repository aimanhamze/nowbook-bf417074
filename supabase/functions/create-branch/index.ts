import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

// Multi-branch: adds another provider_profiles row (a branch) to an EXISTING
// provider owner. The owner keeps one login and switches between branches in
// the dashboard. create-provider is untouched — it still creates a new owner.
//
// Admin-only. The owner must already be a provider with at least one branch,
// so this can never turn a customer account into a provider.

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is authenticated — pass token directly to getUser()
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
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
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const { owner_user_id, business_name, category, city, phone } = await req.json();

    if (!owner_user_id || !business_name?.trim() || !category) {
      return json({ error: "owner_user_id, business_name and category are required" }, 400);
    }

    // The owner must already be a provider…
    const { data: ownerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", owner_user_id)
      .eq("role", "provider")
      .maybeSingle();
    if (!ownerRole) {
      return json({ error: "הבעלים אינו ספק קיים" }, 400);
    }

    // …with at least one existing branch.
    const { count: existingBranches, error: countError } = await adminClient
      .from("provider_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", owner_user_id);
    if (countError) throw countError;
    if (!existingBranches) {
      return json({ error: "לבעלים אין סניף קיים" }, 400);
    }

    const { data: branch, error: branchError } = await adminClient
      .from("provider_profiles")
      .insert({
        user_id: owner_user_id,
        business_name: business_name.trim(),
        category,
        address: city?.trim() || "",
        phone: phone?.trim() || "",
      })
      .select()
      .single();
    if (branchError) {
      // 23505 = unique_violation: the multi-branch migration (which drops
      // UNIQUE (user_id)) has not been applied to this database yet.
      if (branchError.code === "23505") {
        return json({ error: "ריבוי סניפים עדיין לא הופעל במסד הנתונים (המיגרציה לא הוחלה)" }, 409);
      }
      throw branchError;
    }

    // Seed the full weekly availability exactly as create-provider does, so the
    // branch has the 7 rows (day_of_week 0–6) every reader expects:
    //   dow 0–4 (Sun–Thu) → open  09:00–17:00
    //   dow 5–6 (Fri–Sat) → closed 09:00–17:00
    const availabilityRows = Array.from({ length: 7 }, (_, dow) => ({
      provider_id: branch.id,
      day_of_week: dow,
      start_time: "09:00",
      end_time: "17:00",
      is_available: dow >= 0 && dow <= 4,
    }));

    // Log-and-continue, as in create-provider: the branch row is committed, and
    // a branch with no hours is recoverable by the idempotent backfill.
    const { error: availabilityError } = await adminClient
      .from("provider_availability")
      .insert(availabilityRows);
    if (availabilityError) {
      console.error("create-branch: availability seed failed:", availabilityError.message);
    }

    return json(
      {
        provider: branch,
        user_id: owner_user_id,
        availability_seeded: !availabilityError,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-branch error:", message);
    return json({ error: message }, 500);
  }
});
