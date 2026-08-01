import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { customerKey, isRegisteredKey } from "@/lib/customerKey";

export interface ProviderCustomer {
  /** Stable React key + dedupe identity — see lib/customerKey. */
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
 * Dedupe / counting: delegated ENTIRELY to lib/customerKey — account
 * (user_id, else linked_user_id) -> digit-normalized phone -> booking id.
 * This hook and useProviderStats previously keyed walk-ins differently and
 * returned different unique-customer counts for the same provider; they now
 * share one implementation. Two consequences vs. the old local logic:
 *   - phone formats ("050-1234567" / "+972501234567") now collapse to ONE
 *     customer instead of counting separately;
 *   - a walk-in the link_walkin_to_account trigger matched to an account now
 *     merges with that person's own app bookings instead of showing twice.
 * Both reduce the customer count — the previous numbers were over-counted.
 *
 * PII surface is UNCHANGED: profiles are still read for user_id only. A linked
 * walk-in keeps showing the name/phone the provider typed on the booking; we
 * deliberately do not resolve the matched account's profile, which would expose
 * a display name the provider never had.
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
        .select("id, user_id, linked_user_id, customer_name, customer_phone")
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
        const key = customerKey(b);
        // `registered` is derived from the KEY, not from this row, so it cannot
        // flip with iteration order: a person with both an app booking and a
        // linked walk-in resolves to one "u:" key and is registered either way.
        const registered = isRegisteredKey(key);

        // Registered: prefer the account's profile details over typed-in text.
        // A linked walk-in has no user_id, so it falls back to the booking row
        // and any app booking of the same person backfills the profile name.
        const p = b.user_id ? profileMap.get(b.user_id) : undefined;
        const name = p?.display_name ?? b.customer_name ?? null;
        const phone = p?.phone ?? b.customer_phone ?? null;

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
