import { useId } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsSwitch } from "@/components/dashboard/SettingsSwitch";
import { useLang } from "@/contexts/LangContext";
import {
  DEFAULT_BREAK_END, DEFAULT_BREAK_START, type DayDraft, type HoursError,
} from "@/lib/weeklyHours";

// Dark accent ink for inline validation text (the brand accent is too light
// for 12px text). Same value as the setup hub's "missing" line.
const ERROR_INK = "text-[hsl(24_80%_34%)]";

/**
 * Controlled editor for one day's hours, shared by the weekly day sheet and
 * the monthly date sheet: open/closed, opening and closing time, and an
 * optional break. It owns no data and saves nothing. The caller holds the
 * draft, validates it (validateDay) and decides what Save writes.
 */
export function DayHoursEditor({
  value,
  onChange,
  error,
  closedHint,
  showOpenSwitch = true,
}: {
  value: DayDraft;
  onChange: (next: DayDraft) => void;
  error: HoursError | null;
  /** Shown under the switch while the day is closed. */
  closedHint: string;
  /** false = hours only (special openings are always open). */
  showOpenSwitch?: boolean;
}) {
  const { t } = useLang();
  const switchId = useId();
  const errorId = useId();
  const set = (patch: Partial<DayDraft>) => onChange({ ...value, ...patch });
  const hasBreak = value.breakStart !== null || value.breakEnd !== null;

  return (
    <div className="space-y-4">
      {showOpenSwitch && (
        <label
          htmlFor={switchId}
          className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-foreground/[0.03] px-4"
        >
          <span className="text-sm font-semibold">{t("editDayOpenLabel")}</span>
          <SettingsSwitch id={switchId} checked={value.open} onCheckedChange={(open) => set({ open })} />
        </label>
      )}

      {!value.open ? (
        <p className="px-1 text-xs leading-relaxed text-foreground/70">{closedHint}</p>
      ) : (
        <>
          <TimePair
            first={{ label: t("hrsOpens"), value: value.start, onChange: (start) => set({ start }) }}
            second={{ label: t("hrsCloses"), value: value.end, onChange: (end) => set({ end }) }}
            describedBy={error ? errorId : undefined}
          />

          {hasBreak ? (
            <div className="space-y-2 rounded-2xl bg-foreground/[0.03] p-3">
              <TimePair
                first={{ label: t("hrsBreakStart"), value: value.breakStart ?? "", onChange: (breakStart) => set({ breakStart }) }}
                second={{ label: t("hrsBreakEnd"), value: value.breakEnd ?? "", onChange: (breakEnd) => set({ breakEnd }) }}
                describedBy={error ? errorId : undefined}
              />
              <button
                type="button"
                onClick={() => set({ breakStart: null, breakEnd: null })}
                className="min-h-11 rounded-xl px-2 text-sm font-medium text-foreground/70 hover:text-foreground"
              >
                {t("hrsRemoveBreak")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => set({ breakStart: DEFAULT_BREAK_START, breakEnd: DEFAULT_BREAK_END })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent hover:bg-accent/10"
            >
              <Plus className="h-4 w-4" />
              {t("hrsAddBreak")}
            </button>
          )}

          {error && (
            <p id={errorId} role="alert" className={`px-1 text-xs font-medium ${ERROR_INK}`}>
              {t(error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

type Field = { label: string; value: string; onChange: (v: string) => void };

/** Two labelled time fields side by side; first sits at the reading start. */
function TimePair({ first, second, describedBy }: { first: Field; second: Field; describedBy?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TimeField {...first} describedBy={describedBy} />
      <TimeField {...second} describedBy={describedBy} />
    </div>
  );
}

function TimeField({ label, value, onChange, describedBy }: Field & { describedBy?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block px-1 text-xs font-medium text-foreground/70">{label}</label>
      {/* Times always read left-to-right, also in he/ar. */}
      <Input
        id={id}
        type="time"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        className="h-11 rounded-xl text-center text-base tabular-nums"
      />
    </div>
  );
}
