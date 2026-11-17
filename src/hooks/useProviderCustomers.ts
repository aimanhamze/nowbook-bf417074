import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { isRegisteredKey } from "@/lib/customerKey";
import { BOOKINGS_KEY, BOOKINGS_STALE_MS } from "@/lib/providerBookingsKey";

export interface ProviderCustomer {
  /** Stable React key + dedupe identity — see lib/customerKey. */
  key: string;
  name: string | null;
  phone: string | null;
  bookingCount: number;
  /**
   * Most recent booking_date for this customer, "YYYY-MM-DD".
   *
   * Includes future bookings — it is the last date on their record, not
   * strictly the last date they attended, which the schema cannot know.
   */
  lastVisit: string | null;
  /** Whether this customer has a registered account (vs. a provider-created walk-in). */
  registered: boolean;
}

/** One customer as provider_customers() returns it. */
interface ProviderCustomerRow {
  key: string;
  name: string | null;
  phone: string | null;
  booking_count: number;
  last_visit: string | null;
}

// provider_customers is not in the generated types.ts yet (repo convention:
// cast until types are regenerated).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * SINGLE source of customer PII for the provider's "My Customers" view.
 *
 * ⚠️ ALL reads of customer name/phone are intentionally isolated here. Do not
 * replicate them elsewhere.
 *
 * The grouping runs in the database: provider_customers(provider) (migration
 * 20261117000001) returns one row per customer in ONE request. This hook used
 * to download every booking the provider ever had, plus every registered
 * customer's profile, and group them in the browser.
 *
 * The function is a line-for-line port of that grouping, so the list is the
 * same — and it must stay in step with lib/customerKey, which the statistics
 * still use client-side:
 *   - identity: account (user_id, else linked_user_id) -> the phone's last 9
 *     digits -> the booking id;
 *   - bookingCount: every booking, EVERY status (cancelled included);
 *   - lastVisit: the latest booking_date;
 *   - name / phone: the account's profile for an app booking, else what the
 *     provider typed on the booking.
 *
 * Scope and PII surface are UNCHANGED. The function is SECURITY INVOKER: it
 * reads bookings and profiles under this provider's own row-level security,
 * exactly as the two client queries did, and profiles are still read for
 * user_id only — a linked walk-in keeps showing the name/phone the provider
 * typed, never the matched account's profile.
 *
 * Sort: most bookings first (desc), tie-broken by name for stable ordering.
 * Done here rather than in SQL so the order cannot change with the database's
 * collation.
 */
export function useProviderCustomers() {
  const { profile } = useProviderProfile();

  return useQuery({
    // Under the bookings prefix: every booking mutation (a new walk-in, a
    // cancellation, a series) refreshes the list through the invalidation it
    // already issues.
    queryKey: [BOOKINGS_KEY, profile?.id, "customers"],
    enabled: !!profile,
    staleTime: BOOKINGS_STALE_MS,
    queryFn: async (): Promise<ProviderCustomer[]> => {
      if (!profile) return [];

      const { data, error } = await db.rpc("provider_customers", { p_provider_id: profile.id });
      if (error) throw error;

      const customers = ((data ?? []) as ProviderCustomerRow[]).map(
        (row): ProviderCustomer => ({
          key: row.key,
          name: row.name ?? null,
          phone: row.phone ?? null,
          bookingCount: row.booking_count,
          lastVisit: row.last_visit ?? null,
          // Derived from the KEY, as before: a person with both an app booking
          // and a linked walk-in resolves to one "u:" key and is registered.
          registered: isRegisteredKey(row.key),
        }),
      );

      return customers.sort(
        (a, b) =>
          b.bookingCount - a.bookingCount ||
          (a.name || a.phone || "").localeCompare(b.name || b.phone || "")
      );
    },
  });
}
