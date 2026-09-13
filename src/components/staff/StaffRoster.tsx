import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { StaffRow, type StaffRowData } from "./StaffRow";
import { WeekDotsHeader } from "./WeekDots";

interface Props {
  members: StaffRowData[];
  dates: readonly Date[];
  onOpen: (id: string) => void;
}

/**
 * Active members first, each with today's chip and the week dots; inactive
 * members under a collapsed disclosure at the bottom, so a deactivated person
 * never reads as part of today's team.
 *
 * The weekday letters render ONCE, above the list, aligned to the dot column
 * on the inline-end side. Every row's dots share that header's cell size and
 * gap, which is what keeps the seven columns lined up down the page.
 */
export function StaffRoster({ members, dates, onOpen }: Props) {
  const { t } = useLang();
  const [showInactive, setShowInactive] = useState(false);

  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);

  return (
    <section>
      <div className="flex items-center justify-between px-3.5 pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("staffThisWeek")}</p>
        {/* Sits over the dots: each row's trailing column stacks the dots above
            the chevron and ends at the same 14px padding this header uses, so
            no extra offset is needed for the columns to line up. */}
        <WeekDotsHeader dates={dates} />
      </div>

      <div className="flex flex-col gap-2">
        {active.map((m, i) => (
          <StaffRow key={m.id} member={m} index={i} onOpen={onOpen} />
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="flex min-h-11 w-full items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-muted-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showInactive ? "rotate-180" : ""}`} />
            <span>{t("staffInactiveGroup").replace("{n}", String(inactive.length))}</span>
          </button>
          {showInactive && (
            <div className="flex flex-col gap-2">
              {inactive.map((m, i) => (
                <StaffRow key={m.id} member={m} index={i} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
