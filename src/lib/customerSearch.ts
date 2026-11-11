import type { ProviderCustomer } from "@/hooks/useProviderCustomers";

// Customer search for the new-appointment sheet (CustomerPicker).

/** Strip everything but digits so "054-123" matches "0541234567". */
const digits = (s: string) => s.replace(/\D/g, "");

export const MAX_RESULTS = 5;

/**
 * Same match as the old autocomplete — name contains the query, OR the
 * phone's digits contain the query's digits — ranked so the best matches come
 * first: a name or phone that STARTS with the query, then a word in the name
 * that does, then anything that merely contains it. Ties: more bookings, then
 * the most recent booking date.
 */
export function rankCustomers(customers: ProviderCustomer[], query: string): ProviderCustomer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qDigits = digits(q);
  const scored: Array<{ c: ProviderCustomer; score: number }> = [];
  for (const c of customers) {
    const name = (c.name || "").toLowerCase();
    const phone = digits(c.phone || "");
    const nameHit = name.includes(q);
    const phoneHit = qDigits.length > 0 && phone.includes(qDigits);
    if (!nameHit && !phoneHit) continue;
    let score = 0;
    if (nameHit) score = name.startsWith(q) ? 4 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 3 : 2;
    if (phoneHit) score = Math.max(score, phone.startsWith(qDigits) ? 4 : 1);
    scored.push({ c, score });
  }
  return scored
    .sort((a, b) =>
      b.score - a.score ||
      b.c.bookingCount - a.c.bookingCount ||
      (b.c.lastVisit ?? "").localeCompare(a.c.lastVisit ?? ""))
    .slice(0, MAX_RESULTS)
    .map((s) => s.c);
}

/** With nothing typed: the customers with the latest booking date first. */
export function recentCustomers(customers: ProviderCustomer[]): ProviderCustomer[] {
  return [...customers]
    .sort((a, b) => (b.lastVisit ?? "").localeCompare(a.lastVisit ?? ""))
    .slice(0, MAX_RESULTS);
}

/** Looks like a phone number rather than a name ("054-12", "+972…"). */
export const looksLikePhone = (s: string) => /^[+\d\s\-()]+$/.test(s.trim()) && digits(s).length >= 3;

