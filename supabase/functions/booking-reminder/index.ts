import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find bookings happening in the next 60-75 minutes (runs every 15 min)
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 60 * 1000);
    const in75 = new Date(now.getTime() + 75 * 60 * 1000);

    // Booking times are stored in Israel local time. Derive the current Israel
    // UTC offset dynamically so DST transitions (Mar/Oct) are handled correctly.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0");
    const israelMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const israelOffsetMs = israelMs - now.getTime(); // e.g. +10800000 for UTC+3

    // Fetch today + tomorrow in Israel local time (covers midnight boundary)
    const israelNow = new Date(now.getTime() + israelOffsetMs);
    const todayStr = israelNow.toISOString().split("T")[0];
    const tomorrowStr = new Date(israelNow.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Get bookings for today and tomorrow that are confirmed
    const { data: bookings, error: bErr } = await supabase
      .from("bookings")
      .select("id, user_id, provider_id, booking_date, booking_time, service_ids")
      .eq("status", "confirmed")
      .in("booking_date", [todayStr, tomorrowStr]);

    if (bErr) throw bErr;

    const remindable = (bookings || []).filter((b) => {
      // Parse stored local time, then convert to UTC for comparison
      const bookingLocalMs = new Date(`${b.booking_date}T${b.booking_time}:00`).getTime();
      const bookingDateTime = new Date(bookingLocalMs - israelOffsetMs);
      return bookingDateTime >= in60 && bookingDateTime < in75;
    });

    let sent = 0;

    for (const booking of remindable) {
      // Check if reminder already sent
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", booking.user_id)
        .eq("type", "reminder")
        .eq("url", `/provider/${booking.provider_id}`)
        .gte("created_at", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: provider } = await supabase
        .from("provider_profiles")
        .select("business_name")
        .eq("id", booking.provider_id)
        .single();

      const providerName = provider?.business_name || "ספק";

      // Insert notification
      await supabase.from("notifications").insert({
        user_id: booking.user_id,
        title: `⏰ תזכורת: יש לך תור בעוד שעה`,
        body: `התור שלך אצל ${providerName} בשעה ${booking.booking_time}`,
        type: "reminder",
        url: `/provider/${booking.provider_id}`,
      });

      sent++;
    }

    return new Response(
      JSON.stringify({ ok: true, checked: remindable.length, sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
