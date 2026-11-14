import { useLang } from "@/contexts/LangContext";
import type { ProviderRegistration } from "@/hooks/useAcademyRegistrations";
import { customerLabel } from "@/lib/customerLabel";

/** The customer's display name (never an email) — see lib/customerLabel. */
export function useRegistrantName() {
  const { t } = useLang();
  return (r: Pick<ProviderRegistration, "customer_name" | "customer_phone"> | null | undefined) =>
    customerLabel(r?.customer_name, r?.customer_phone, t("academyUnknownCustomer"));
}
