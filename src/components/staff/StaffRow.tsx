import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { ForwardArrow } from "@/components/ui/directional-icon";
import type { MemberDayStatus } from "@/lib/staffToday";
import { StaffAvatar } from "./StaffAvatar";
import { TodayChip } from "./TodayChip";
import { WeekDots } from "./WeekDots";

export interface StaffRowData {
  id: string;
  name: string;
  isActive: boolean;
  /** Today first. Ignored for inactive members. */
  week: MemberDayStatus[];
  servicesSummary: string;
  hoursSummary: string;
  /** Empty string when there is no upcoming time off — absence earns no label. */
  timeOffSummary: string;
}

interface Props {
  member: StaffRowData;
  index: number;
  onOpen: (id: string) => void;
}

/**
 * One roster row. Tier-2 `.surface-soft` — repeated items must not each carry a
 * backdrop-filter inside an already-glass page.
 *
 * Summaries STACK on two lines instead of joining with separators: the Arabic
 * strings run long, and a truncated single line would hide exactly the state
 * the row exists to show. The whole row is one button (44px+ target) leading to
 * the member page; there are no inline actions to mis-tap.
 */
export function StaffRow({ member, index, onOpen }: Props) {
  const { t } = useLang();

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={() => onOpen(member.id)}
      className={`surface-soft flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start transition-transform active:scale-[0.99] ${
        member.isActive ? "" : "opacity-75"
      }`}
    >
      <StaffAvatar id={member.id} name={member.name} muted={!member.isActive} />

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-[15px] font-semibold ${member.isActive ? "" : "text-muted-foreground line-through"}`}>
            {member.name}
          </span>
          <TodayChip status={member.isActive ? member.week[0] : null} />
        </span>
        {member.isActive ? (
          <span className="flex flex-col text-xs leading-snug text-muted-foreground">
            <span>{member.servicesSummary}</span>
            <span>
              {member.hoursSummary}
              {member.timeOffSummary && <> · {member.timeOffSummary}</>}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("staffInactiveHint")}</span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-2.5">
        {member.isActive && <WeekDots week={member.week} />}
        <ForwardArrow className="h-4 w-4 text-muted-foreground" />
      </span>
    </motion.button>
  );
}
