import { ForwardArrow } from "@/components/ui/directional-icon";
import { StaffAvatar } from "@/components/staff/StaffAvatar";
import { ROW } from "@/components/dashboard/settingsList";
import { useLang } from "@/contexts/LangContext";
import type { ProviderRegistration } from "@/hooks/useAcademyRegistrations";
import { labelIsPhone } from "@/lib/customerLabel";
import { useRegistrantName } from "./registrantName";
import { cn } from "@/lib/utils";
import { RegistrationStatusBadge } from "@/components/academy/customer/RegistrationStatusBadge";

/**
 * One registration in a compact list: initial avatar, name, phone (LTR) and
 * the status badge. The whole row opens the registration sheet.
 */
export function RegistrantRow({ registration: r, onOpen }: { registration: ProviderRegistration; onOpen: () => void }) {
  const { t } = useLang();
  const name = useRegistrantName()(r);
  const nameIsPhone = labelIsPhone(r.customer_name, r.customer_phone);
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" className={ROW}>
      {/* A phone has no meaningful initial: the avatar then shows the word "customer"'s. */}
      <StaffAvatar id={r.user_id} name={nameIsPhone ? t("academyUnknownCustomer") : name} />
      <span className="min-w-0 flex-1">
        <span
          dir={nameIsPhone ? "ltr" : "auto"}
          className={cn("block truncate text-sm font-semibold leading-snug", "rtl:text-right")}
        >
          {name}
        </span>
        {r.customer_phone && !nameIsPhone && (
          <span className="mt-0.5 block text-xs leading-snug text-foreground/70">
            <bdi dir="ltr">{r.customer_phone}</bdi>
          </span>
        )}
      </span>
      <RegistrationStatusBadge status={r.status} className="shrink-0" />
      <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
    </button>
  );
}
