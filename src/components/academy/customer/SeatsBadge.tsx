import { Users } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { SeatsState } from "@/lib/academyCustomer";
import { cn } from "@/lib/utils";

/** "N seats left" / "Only N left" / "Course full"; nothing while counts are unknown. */
export function SeatsBadge({ seats, className }: { seats: SeatsState; className?: string }) {
  const { t } = useLang();
  if (seats.kind === "unknown") return null;
  const text =
    seats.kind === "full"
      ? t("academySeatsFull")
      : (seats.kind === "few" ? t("academySeatsFew") : t("academySeatsLeft")).replace("{n}", String(seats.free));
  const tone =
    seats.kind === "full"
      ? "bg-red-100 text-red-700"
      : seats.kind === "few"
        ? "bg-amber-100 text-amber-800"
        : "bg-green-100 text-green-700";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
      <Users className="h-3 w-3" />
      {text}
    </span>
  );
}
