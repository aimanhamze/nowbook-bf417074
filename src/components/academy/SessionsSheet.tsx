import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditSheet, Field, SHEET_LIST } from "@/components/dashboard/SettingsRows";
import { GROUP_HEADING } from "@/components/dashboard/settingsList";
import { useLang } from "@/contexts/LangContext";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import type { AcademyCourseRow, AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { academyErrorMessage } from "@/lib/academyErrors";
import {
  type DateRangeResult,
  expandDateRange,
  isSessionPast,
  isValidTimeRange,
  jerusalemNow,
  MAX_SESSIONS_PER_BATCH,
  sessionWritesForDates,
  toDbTime,
  toTimeInput,
} from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { narrowWeekdayLabels, weekDates } from "@/lib/staffToday";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: AcademyCourseRow | null;
  sessions: AcademyCourseSessionRow[];
}

// Any Sunday: the weekday toggles label 0–6, not real dates.
const DOW_DATES = weekDates(new Date(2024, 0, 7), 7);

const INPUT = "h-12 rounded-xl";
const ICON_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground/50 transition-colors hover:bg-foreground/[0.05] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

/**
 * A course's sessions: add a date range with the same hours (optionally only
 * on some weekdays), and edit or delete each day on its own. Every action
 * saves at once (there is no sheet-level Save).
 *
 * The whole range is ONE insert. If any of those dates overlaps another
 * session of the same instructor, the database refuses all of them (23P01)
 * and the message says the instructor is busy — nothing is half-added.
 */
export function SessionsSheet({ open, onOpenChange, course, sessions }: Props) {
  const { t, lang } = useLang();
  const { addSessions, updateSession, deleteSession } = useAcademyCourses();
  const locale = dateFnsLocaleFor(lang);
  const dowLabels = useMemo(() => narrowWeekdayLabels(DOW_DATES, locale), [locale]);

  const today = jerusalemNow().date;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:00");
  const [showPast, setShowPast] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ date: "", start: "", end: "" });

  useEffect(() => {
    if (open) {
      const now = jerusalemNow().date;
      setFrom(now);
      setTo(now);
      setWeekdays([]);
      setEditingId(null);
      setShowPast(false);
    }
  }, [open]);

  const range = useMemo(() => expandDateRange(from, to, weekdays), [from, to, weekdays]);
  const timesOk = isValidTimeRange(start, end);

  const rangeMessage = (() => {
    if (range.ok) return t("academySessionPreview").replace("{n}", String(range.dates.length));
    // Explicit: the project is not under strictNullChecks, so `ok` alone does
    // not narrow the union.
    const { reason } = range as Extract<DateRangeResult, { ok: false }>;
    if (reason === "reversed") return t("academySessionRangeInvalid");
    if (reason === "empty") return t("academySessionRangeEmpty");
    if (reason === "too_many") return t("academySessionRangeTooLong").replace("{n}", String(MAX_SESSIONS_PER_BATCH));
    return t("academyErrInvalid");
  })();

  const now = jerusalemNow();
  const upcoming = sessions.filter((s) => !isSessionPast(s, now));
  const past = sessions.filter((s) => isSessionPast(s, now));

  const toggleDay = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const onAdd = async () => {
    if (!course || !range.ok || !timesOk) return;
    try {
      const n = await addSessions.mutateAsync({
        courseId: course.id,
        sessions: sessionWritesForDates(range.dates, start, end),
      });
      toast.success(t("academySessionsAdded").replace("{n}", String(n)));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const beginEdit = (s: AcademyCourseSessionRow) => {
    setEditingId(s.id);
    setEdit({ date: s.session_date, start: toTimeInput(s.start_time), end: toTimeInput(s.end_time) });
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    if (!isValidTimeRange(edit.start, edit.end)) {
      toast.error(t("academyErrSessionTimes"));
      return;
    }
    try {
      await updateSession.mutateAsync({
        id: editingId,
        values: { session_date: edit.date, start_time: toDbTime(edit.start), end_time: toDbTime(edit.end) },
      });
      toast.success(t("academySessionSaved"));
      setEditingId(null);
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteSession.mutateAsync({ id });
      toast.success(t("academySessionDeleted"));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const row = (s: AcademyCourseSessionRow, isPast: boolean) =>
    editingId === s.id ? (
      <li key={s.id} className="space-y-2 px-4 py-3">
        <Input
          type="date"
          value={edit.date}
          aria-label={t("academySessionDate")}
          onChange={(e) => setEdit((x) => ({ ...x, date: e.target.value }))}
          className={INPUT}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="time"
            value={edit.start}
            aria-label={t("academySessionStart")}
            onChange={(e) => setEdit((x) => ({ ...x, start: e.target.value }))}
            className={INPUT}
          />
          <Input
            type="time"
            value={edit.end}
            aria-label={t("academySessionEnd")}
            onChange={(e) => setEdit((x) => ({ ...x, end: e.target.value }))}
            className={INPUT}
          />
        </div>
        <div className="flex gap-2">
          <Button className="h-11 flex-1 rounded-xl" onClick={() => void onSaveEdit()} disabled={updateSession.isPending}>
            {t("save")}
          </Button>
          <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setEditingId(null)}>
            {t("cancel")}
          </Button>
        </div>
      </li>
    ) : (
      <li key={s.id} className={cn("flex min-h-[56px] items-center gap-1 py-1.5 ps-4 pe-2", isPast && "opacity-60")}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{format(parseISO(s.session_date), "EEE, d MMM yyyy", { locale })}</p>
          {/* The paragraph follows the page direction (aligned under the date);
              only the times are LTR so "18:00–20:30" never flips. */}
          <p className="text-xs text-foreground/70">
            <bdi dir="ltr">
              {toTimeInput(s.start_time)}–{toTimeInput(s.end_time)}
            </bdi>
          </p>
        </div>
        <button type="button" onClick={() => beginEdit(s)} aria-label={t("academySessionEdit")} className={ICON_BTN}>
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void onDelete(s.id)}
          disabled={deleteSession.isPending}
          aria-label={t("academySessionDelete")}
          className={cn(ICON_BTN, "hover:text-red-600")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </li>
    );

  const list = (items: AcademyCourseSessionRow[], isPast: boolean) => (
    <ul className={cn(SHEET_LIST, "divide-y divide-foreground/[0.07]")}>{items.map((s) => row(s, isPast))}</ul>
  );

  return (
    <EditSheet
      open={open}
      onClose={() => onOpenChange(false)}
      icon={CalendarDays}
      title={t("academySessionsTitle")}
      description={course?.name}
    >
      {/* Add a range */}
      <section className="space-y-3">
        <h3 className={GROUP_HEADING}>{t("academySessionAdd")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("academySessionFrom")} htmlFor="range-from">
            <Input id="range-from" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("academySessionTo")} htmlFor="range-to">
            <Input id="range-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={INPUT} />
          </Field>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("academySessionDays")}</p>
          <div className="grid grid-cols-7 gap-1">
            {dowLabels.map((label, d) => {
              const on = weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-xl text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    on ? "bg-accent text-accent-foreground" : "bg-foreground/[0.05] text-foreground/60",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("academySessionStart")} htmlFor="range-start">
            <Input id="range-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("academySessionEnd")} htmlFor="range-end">
            <Input id="range-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} />
          </Field>
        </div>
        {!timesOk && <p role="alert" className="text-xs font-medium text-red-600">{t("academyErrSessionTimes")}</p>}
        <p className={cn("text-xs", range.ok ? "text-foreground/60" : "font-medium text-red-600")}>{rangeMessage}</p>

        <Button
          type="button"
          className="h-12 w-full gap-1.5 rounded-2xl text-base font-semibold"
          onClick={() => void onAdd()}
          disabled={!course || !range.ok || !timesOk || addSessions.isPending}
        >
          <Plus className="h-4 w-4" />
          {t("academySessionAdd")}
        </Button>
      </section>

      {/* Existing sessions */}
      {sessions.length === 0 ? (
        <p className="py-4 text-center text-sm text-foreground/60">{t("academyCourseNoSessions")}</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h3 className={GROUP_HEADING}>{t("acSessionsUpcoming")}</h3>
              {list(upcoming, false)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                aria-expanded={showPast}
                className="flex min-h-11 w-full items-center gap-1.5 px-1 text-xs font-semibold text-foreground/60"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", showPast && "rotate-180")} />
                {t("acSessionsPast").replace("{n}", String(past.length))}
              </button>
              {showPast && list(past, true)}
            </section>
          )}
        </>
      )}
    </EditSheet>
  );
}
