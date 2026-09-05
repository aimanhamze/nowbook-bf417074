import { AlertTriangle, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/contexts/LangContext";
import {
  seedDraftFromShop,
  isInvalidRange,
  isOutsideShopDay,
  toTimeInput,
  type DayHours,
  type StaffHoursDraft,
} from "@/lib/staffHours";
import { cn } from "@/lib/utils";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

// A MONTHLY-mode shop has no weekly rows to seed from, so seeding from shopDays
// would hand the owner a week of off days — a trap, since off means "does not
// work" here. A neutral full week at the table's own column defaults is the
// honest starting point; the owner narrows it from there.
const NEUTRAL_WEEK: (DayHours | null)[] = Array.from({ length: 7 }, () => ({
  is_available: true,
  start_time: "09:00",
  end_time: "17:00",
}));

interface Props {
  /** null = works all shop hours (zero rows). An array = a configured week. */
  draft: StaffHoursDraft;
  onChange: (next: StaffHoursDraft) => void;
  /** The SHOP's own week, indexed by day_of_week; null = closed that day. */
  shopDays: readonly (DayHours | null)[];
  /**
   * The shop's week is still loading, so `shopDays` is all-null and does NOT yet
   * mean "closed every day". Every shop-derived line is suppressed while true —
   * without this the editor briefly shouts "Shop closed this day — this member
   * won't be available" on all seven rows, which is both wrong and alarming.
   */
  shopLoading: boolean;
  /** Monthly-mode shops have no per-weekday hours to compare against. */
  isMonthly: boolean;
}

/**
 * The per-staff working-hours editor, rendered inside the Staff page's hours
 * sheet (components/staff/member/HoursSheet.tsx), which supplies the title.
 *
 * PURELY PRESENTATIONAL — it owns no state and performs no writes. Everything
 * it produces goes into the sheet's draft and reaches the database
 * only if the owner presses Save. That separation is what makes the "never write
 * rows on first open" guarantee structural rather than remembered: this
 * component has no mutation to call.
 *
 * THE MODE TOGGLE IS THE WHOLE DESIGN. `draft === null` (works all shop hours,
 * stored as zero rows) and `draft !== null` (a configured week) are two states
 * an owner switches between explicitly, and the SAME switch is both the entrance
 * and the exit — so returning a member to "all shop hours", which is the only
 * way to delete their rows, is exactly where someone would look for it.
 *
 * The mode is derived from the draft the parent computed from ROWS, never from
 * any form value, so opening the sheet can never look like a configuration.
 */
export function StaffHoursEditor({ draft, onChange, shopDays, shopLoading, isMonthly }: Props) {
  const { t } = useLang();

  const configured = draft !== null;

  // Switching ON seeds from the SHOP's own week rather than from a blank form:
  // the new state starts visibly identical to the old one, so the toggle reads
  // as "start from the shop's hours and narrow them" instead of "throw away what
  // you had". This is LOCAL STATE ONLY — see the note above.
  //
  // Switching OFF drops straight back to null. The rows are not deleted here;
  // they are deleted when the owner saves, which is what keeps Cancel honest.
  const handleMode = (next: boolean) => {
    onChange(next ? seedDraftFromShop(isMonthly ? NEUTRAL_WEEK : shopDays) : null);
  };

  // Everything derived from the shop's week is only meaningful once it has
  // loaded and only in weekly mode. One flag, used by all three shop-derived
  // renderings below, so they cannot disagree about when the data is real.
  const shopKnown = !isMonthly && !shopLoading;

  const patchDay = (dow: number, patch: Partial<DayHours>) => {
    if (!draft) return;
    onChange(draft.map((day, i) => (i === dow ? { ...day, ...patch } : day)));
  };

  const shopRange = (shop: DayHours) =>
    `${toTimeInput(shop.start_time)}–${toTimeInput(shop.end_time)}`;

  return (
    <div className="space-y-2">
      {/* Mode toggle. The helper line under it changes with the mode so the
          CURRENT state is always stated in words, and — when configured — so the
          way back to "all shop hours" is spelled out rather than inferred. */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors",
          configured ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-card"
        )}
      >
        {/* Held while the shop's week loads: switching ON before it arrives
            would seed from an all-null week and hand the owner seven off days. */}
        <Switch
          checked={configured}
          onCheckedChange={handleMode}
          disabled={shopLoading && !isMonthly}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("staffHoursCustomToggle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {configured ? t("staffHoursRevertHint") : t("staffHoursAllHint")}
          </p>
        </div>
      </div>

      {configured && (
        <div className="space-y-2">
          {/* THE THREE-STATE WARNING. An owner who fills in Mon–Fri has made
              this member unbookable at weekends — not left them on shop hours.
              That is the one thing about this feature that surprises people, so
              it is stated up front, in the mode where it applies, rather than
              left for them to discover from a customer. */}
          <p className="flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-foreground/75">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>{t("staffHoursOffDayWarning")}</span>
          </p>

          {/* Monthly-mode shops have no weekly rows to compare a staff week
              against, so the per-day "Shop: …" reference below is suppressed and
              this note explains what the staff week still does. */}
          {isMonthly && (
            <p className="rounded-2xl border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {t("staffHoursMonthlyNote")}
            </p>
          )}

          {DAY_KEYS.map((dayKey, dow) => {
            const day = draft[dow];
            // In monthly mode there is no per-weekday shop window, so the
            // comparison is skipped entirely — isOutsideShopDay would treat the
            // absent window as "shop closed" and flag every single day.
            const shop = shopKnown ? shopDays[dow] ?? null : null;
            const invalid = isInvalidRange(day);
            const outside = shopKnown && isOutsideShopDay(day, shop);

            return (
              <div
                key={dayKey}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 transition-colors",
                  day.is_available ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-card"
                )}
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={day.is_available}
                    onCheckedChange={(next) => patchDay(dow, { is_available: next })}
                  />
                  <span className="w-16 shrink-0 text-sm font-medium">{t(dayKey)}</span>
                  {day.is_available ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <Input
                        type="time"
                        aria-label={`${t(dayKey)} ${t("staffHoursLabel")}`}
                        className="h-8 flex-1 text-xs"
                        value={day.start_time}
                        onChange={(e) => patchDay(dow, { start_time: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        type="time"
                        aria-label={`${t(dayKey)} ${t("staffHoursLabel")}`}
                        className="h-8 flex-1 text-xs"
                        value={day.end_time}
                        onChange={(e) => patchDay(dow, { end_time: e.target.value })}
                      />
                    </div>
                  ) : (
                    // NOT blank and NOT "inherits" — an off day says so in words,
                    // because a silent empty cell is exactly what reads as
                    // "unconfigured, so it must follow the shop".
                    <span className="flex-1 text-xs font-medium text-muted-foreground">
                      {t("staffHoursOff")}
                    </span>
                  )}
                </div>

                {/* Sub-line, in priority order: a broken window first (it saves
                    nothing bookable), then time that will be trimmed away, then
                    the shop's own hours as a plain reference. Indented past the
                    switch so it reads as belonging to the row. */}
                <div className="mt-1.5 ps-12">
                  {invalid ? (
                    <p className="text-[11px] font-medium text-destructive">
                      {t("staffHoursInvalidRange")}
                    </p>
                  ) : outside ? (
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {shop && shop.is_available
                        ? t("staffHoursOutsideShop").replace("{range}", shopRange(shop))
                        : t("staffHoursShopClosedDay")}
                    </p>
                  ) : shopKnown ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Store className="h-3 w-3 shrink-0" />
                      {shop && shop.is_available
                        ? `${t("staffHoursShopPrefix")} ${shopRange(shop)}`
                        : t("staffHoursShopClosed")}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* The subset guarantee, stated where the owner is setting times. */}
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("staffHoursSubsetNote")}
          </p>
        </div>
      )}
    </div>
  );
}
