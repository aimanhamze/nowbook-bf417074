import { supabase } from "@/integrations/supabase/client";
import { inBatches } from "@/lib/fetchAll";

export interface CustomerContact {
  name: string | null;
  phone: string | null;
}

/**
 * Name + phone for a set of customers, for a provider who must reach them
 * (course registrants). Selects ONLY user_id, display_name and phone from
 * profiles — never `*` — in batches, like the bookings/customers hooks. Kept
 * in one function so the read can move behind a SECURITY DEFINER RPC later
 * without touching any screen. A failed batch only leaves names blank.
 */
export async function fetchCustomerContacts(userIds: string[]): Promise<Map<string, CustomerContact>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await inBatches<{ user_id: string; display_name: string | null; phone: string | null }>(ids, (batch) =>
    supabase.from("profiles").select("user_id, display_name, phone").in("user_id", batch),
  );
  return new Map(rows.map((r) => [r.user_id, { name: r.display_name, phone: r.phone }]));
}
