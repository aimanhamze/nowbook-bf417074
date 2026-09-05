import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { StaffHoursEditor } from "@/components/settings/StaffHoursEditor";
import { isInvalidRange, type DayHours, type StaffHoursDraft } from "@/lib/staffHours";
import { FacetSheet } from "./FacetSheet";

interface Props {
  open: boolean;
  onClose: () => void;
  memberName: string;
  /** Derived from ROWS by the page (draftFromRows). null = works all shop hours. */
  initialDraft: StaffHoursDraft;
  shopDays: readonly (DayHours | null)[];
  shopLoading: boolean;
  isMonthly: boolean;
  onSave: (draft: StaffHoursDraft) => Promise<void>;
  saving: boolean;
}

/**
 * Weekly working hours. Wraps the existing, purely presentational
 * StaffHoursEditor — its mode switch is the whole design (see that file) and
 * nothing about it changes here; only the container does.
 *
 * The one save-blocking validation is the same as before: a window that can
 * never produce a slot is refused BEFORE anything is written. A window that
 * merely pokes outside the shop's is flagged inline and allowed through, because
 * the resolver's intersection trims it at booking time anyway.
 */
export function HoursSheet({ open, onClose, memberName, initialDraft, shopDays, shopLoading, isMonthly, onSave, saving }: Props) {
  const { t } = useLang();
  const [draft, setDraft] = useState<StaffHoursDraft>(null);

  useEffect(() => {
    if (open) setDraft(initialDraft);
  }, [open, initialDraft]);

  const handleSave = () => {
    if (draft?.some(isInvalidRange)) {
      toast.error(t("staffHoursInvalidRange"));
      return;
    }
    void onSave(draft);
  };

  return (
    <FacetSheet
      open={open}
      onClose={onClose}
      icon={Clock}
      title={t("staffHoursLabel")}
      subtitle={memberName}
      saving={saving}
      onSave={handleSave}
    >
      <StaffHoursEditor
        draft={draft}
        onChange={setDraft}
        shopDays={shopDays}
        shopLoading={shopLoading}
        isMonthly={isMonthly}
        hideLabel
      />
    </FacetSheet>
  );
}
