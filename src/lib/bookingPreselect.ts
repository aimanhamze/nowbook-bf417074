// Opening the booking flow with a service already chosen:
// /provider/<id>/book?service=<serviceId> (the provider page's service rows).
//
// Only the standard flow understands it. A fitness studio books a class, not a
// service, and an academy has no booking flow, so both ignore the parameter.

import { isAcademyCategory } from "@/lib/academyCategory";
import type { Provider, Service } from "@/lib/mock-data";

export const PRESELECT_PARAM = "service";

/** The booking flow's path, with the service preselected when one is given. */
export function bookPath(providerId: string, serviceId?: string | null): string {
  const base = `/provider/${providerId}/book`;
  return serviceId ? `${base}?${PRESELECT_PARAM}=${encodeURIComponent(serviceId)}` : base;
}

/**
 * The service a `?service=` value preselects, or null to start the flow as
 * usual: no value, an id this provider does not offer (unknown, inactive, or
 * another provider's), a fitness studio, an academy, or a booking draft that
 * was just restored (the draft is the customer's own later choice and wins).
 */
export function resolvePreselectedService(
  serviceId: string | null | undefined,
  provider: Pick<Provider, "category" | "services">,
  draftRestored = false,
): Service | null {
  if (!serviceId || draftRestored) return null;
  if (provider.category === "fitness_studio" || isAcademyCategory(provider.category)) return null;
  return provider.services.find((s) => s.id === serviceId) ?? null;
}
