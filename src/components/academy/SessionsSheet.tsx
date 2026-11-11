import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: AcademyCourseRow | null;
  sessions: AcademyCourseSessionRow[];
}

// Any Sunday: the weekday toggles label 0–6, not real dates.
const DOW_DATES = weekDates(new Date(2024, 0, 7), 7);

/**
 * A course's sessions: add a date range with the same hours (optionally only
 * on some weekdays), and edit or delete each day on its own.
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ date: "", start: "", end: "" });

  useEffect(() => {
    if (open) {
      const now = jerusalemNow().date;
      setFrom(now);
      setTo(now);
      setWeekdays([]);
      setEditingId(null);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={`max-h-[92vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}>
        <SheetHeader>
          <SheetTitle>
            {t("academySessionsTitle")}
            {course && <span className="font-normal text-muted-foreground"> · {course.name}</span>}
          </SheetTitle>
        </SheetHeader>

        {/* Add a range */}
        <section className="mt-4 space-y-3 rounded-2xl border border-border p-4">
          <h3 className="text-sm font-semibold">{t("academySessionAdd")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="range-from" className="text-xs">{t("academySessionFrom")}</Label>
              <Input id="range-from" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="range-to" className="text-xs">{t("academySessionTo")}</Label>
              <Input id="range-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium">{t("academySessionDays")}</p>
            <div className="mt-1.5 flex gap-1.5">
              {dowLabels.map((label, d) => {
                const on = weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      on ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="range-start" className="text-xs">{t("academySessionStart")}</Label>
              <Input id="range-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="range-end" className="text-xs">{t("academySessionEnd")}</Label>
              <Input id="range-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1" />
            </div>
          </div>
          {!timesOk && <p className="text-xs text-destructive">{t("academyErrSessionTimes")}</p>}

          <p className={`text-xs ${range.ok ? "text-muted-foreground" : "text-destructive"}`}>{rangeMessage}</p>

          <Button
            type="button"
            className="w-full gap-1.5"
            onClick={() => void onAdd()}
            disabled={!course || !range.ok || !timesOk || addSessions.isPending}
          >
            <Plus className="h-4 w-4" />
            {t("academySessionAdd")}
          </Button>
        </section>

        {/* Existing sessions */}
        <section className="mt-4 pb-4">
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("academyCourseNoSessions")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => {
                const past = isSessionPast(s, now);
                return (
                  <li key={s.id} className={`rounded-xl border border-border p-3 ${past ? "opacity-60" : ""}`}>
                    {editingId === s.id ? (
                      <div className="space-y-2">
                        <Input
                          type="date"
                          value={edit.date}
                          aria-label={t("academySessionDate")}
                          onChange={(e) => setEdit((x) => ({ ...x, date: e.target.value }))}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="time"
                            value={edit.start}
                            aria-label={t("academySessionStart")}
                            onChange={(e) => setEdit((x) => ({ ...x, start: e.target.value }))}
                          />
                          <Input
                            type="time"
                            value={edit.end}
                            aria-label={t("academySessionEnd")}
                            onChange={(e) => setEdit((x) => ({ ...x, end: e.target.value }))}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 gap-1" onClick={() => void onSaveEdit()} disabled={updateSession.isPending}>
                            <Check className="h-4 w-4" />
                            {t("save")}
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditingId(null)}>
                            <X className="h-4 w-4" />
                            {t("cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {format(parseISO(s.session_date), "EEE, d MMM yyyy", { locale })}
                          </p>
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {toTimeInput(s.start_time)}–{toTimeInput(s.end_time)}
                          </p>
                        </div>
                        {past && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                            {t("academySessionPast")}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => beginEdit(s)}
                          aria-label={t("academySessionEdit")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(s.id)}
                          disabled={deleteSession.isPending}
                          aria-label={t("academySessionDelete")}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
