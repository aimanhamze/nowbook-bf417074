import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export interface ProviderCustomer {
  /** Stable React key + dedupe identity. `u:<user_id>` for registered, `w:<phone|name>` for walk-ins. */
  key: string;
  name: string | null;
  phone: string | null;
  bookingCount: number;
  /** Whether this customer has a registered account (vs. a provider-created walk-in). */
  registered: boolean;
}

/**
 * SINGLE source of customer PII for the provider's "My Customers" view.
 *
 * ⚠️ ALL reads of customer name/phone (the `profiles` join included) are
 * intentionally isolated here so the data path can later be swapped to a
 * SECURITY DEFINER RPC (e.g. `provider_customers()`) WITHOUT touching any UI.
 * Do not replicate the profiles read elsewhere.
 *
 * Scope: strictly THIS provider's own bookings (`provider_id = <my provider id>`),
 * which the bookings SELECT RLS already restricts to the calling provider.
 *
 * Dedupe / counting:
 *   - registered booking (user_id NOT NULL): keyed on `user_id`; name/phone from `profiles`.
 *   - walk-in booking   (user_id NULL):      keyed on `customer_phone` (fallback `customer_name`,
 *     then booking id); name/phone from the booking row.
 *   The same real person appearing as BOTH a registered booking and a walk-in
 *   will show as two rows in v1 (we deliberately do not phone-merge across the
 *   registered/walk-in boundary — kept simple).
 *
 * Sort: most bookings first (desc), tie-broken by name for stable ordering.
 */
export function useProviderCustomers() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["provider-customers", profile?.id],
    enabled: !!profile,
    queryFn: async (): Promise<ProviderCustomer[]> => {
      if (!profile) return [];

      // This provider's own bookings only. Select the minimum needed to group
      // and identify customers — no service/price/notes columns.
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, user_id, customer_name, customer_phone")
        .eq("provider_id", profile.id);
      if (error) throw error;
      if (!bookings || bookings.length === 0) return [];

      // Resolve registered customers' name + phone from profiles.
      // Select ONLY display_name + phone (never `*`) — minimum PII for the view.
      const userIds = [...new Set(bookings.map((b) => b.user_id).filter(Boolean))] as string[];
      const { data: profiles } = userIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, display_name, phone")
            .in("user_id", userIds)
        : { data: [] as { user_id: string; display_name: string | null; phone: string | null }[] };

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p])
      );

      // Group bookings into unique customers + count.
      const customers = new Map<string, ProviderCustomer>();

      for (const b of bookings) {
        let key: string;
        let name: string | null;
        let phone: string | null;
        let registered: boolean;

        if (b.user_id) {
          // Registered: identity is the account, not the typed-in details.
          const p = profileMap.get(b.user_id);
          key = `u:${b.user_id}`;
          name = p?.display_name ?? null;
          phone = p?.phone ?? null;
          registered = true;
        } else {
          // Walk-in: no account — key on phone, then name, then row id so a
          // detail-less walk-in still shows rather than collapsing everyone.
          const dedupe = b.customer_phone || b.customer_name || b.id;
          key = `w:${dedupe}`;
          name = b.customer_name ?? null;
          phone = b.customer_phone ?? null;
          registered = false;
        }

        const existing = customers.get(key);
        if (existing) {
          existing.bookingCount += 1;
          // Backfill any missing name/phone from a later row of the same customer.
          if (!existing.name && name) existing.name = name;
          if (!existing.phone && phone) existing.phone = phone;
        } else {
          customers.set(key, { key, name, phone, bookingCount: 1, registered });
        }
      }

      return [...customers.values()].sort(
        (a, b) =>
          b.bookingCount - a.bookingCount ||
          (a.name || a.phone || "").localeCompare(b.name || b.phone || "")
      );
    },
  });
}
