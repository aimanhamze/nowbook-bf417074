import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

// Multi-branch: deletes ONE branch (a provider_profiles row) and everything
// that cascades from it — its services, hours, staff, bookings, reviews. The
// owner's login and their other branches are untouched.
//
// Refuses the owner's LAST branch (409): that must go through delete-provider,
// which deletes the owner account itself. Otherwise a provider login with no
// provider row could be left behind.
//
// Admin-only. Runs as service role; provider_profiles DELETE is admin-only in
// RLS as well since 20261003000001.

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

    // Verify caller is authenticated
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

    const { provider_id } = await req.json();
    if (!provider_id) {
      return json({ error: "provider_id is required" }, 400);
    }

    const { data: branch, error: branchError } = await adminClient
      .from("provider_profiles")
      .select("id, user_id")
      .eq("id", provider_id)
      .maybeSingle();
    if (branchError) throw branchError;
    if (!branch) {
      return json({ error: "הסניף לא נמצא" }, 404);
    }

    const { count: ownerBranches, error: countError } = await adminClient
      .from("provider_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", branch.user_id);
    if (countError) throw countError;
    if ((ownerBranches ?? 0) <= 1) {
      return json({ error: "זהו הסניף האחרון של הבעלים — יש למחוק את הספק עצמו" }, 409);
    }

    const { error: deleteError } = await adminClient
      .from("provider_profiles")
      .delete()
      .eq("id", provider_id);
    if (deleteError) throw deleteError;

    return json({ success: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("delete-branch error:", message);
    return json({ error: message }, 500);
  }
});
