import type { ComponentType } from "react";
import {
  BookOpen, Briefcase, CalendarDays, CalendarOff, Check, ClipboardList, Clock, GraduationCap, Images,
  SlidersHorizontal, Store, Ticket,
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { type Lang, type TranslationKey } from "@/lib/translations";
import { usePlural } from "@/hooks/usePlural";
import { useDashboardSetup, type DashboardSetup, type Fact } from "@/hooks/useDashboardSetup";
import {
  joinList, ltr, progressMessage, setupPercent, stepTarget,
  type SectionId, type SetupStepId, type StepTarget,
} from "@/lib/dashboardSetup";

// The setup hub: what /dashboard shows before a section is opened. A progress
// card (only while a required step is missing) over one grouped list of
// sections, each with a live one-line status read from data the dashboard's
// hooks already load (useDashboardSetup). Tapping a row opens the section; the
// class schedule row is the exception — a studio's classes live in /calendar.

type Mark = "done" | "missing" | "none";
type Status = { text: string; tone: "plain" | "missing" } | "loading" | "error";

interface Row {
  key: string;
  icon: ComponentType<{ className?: string }>;
  label: TranslationKey;
  status: Status;
  mark: Mark;
  target: StepTarget;
}

// Dark accent ink for "missing" status text: the brand accent (24 80% 55%)
// is only ~2.9:1 on white, too light for 12px text; this is ≥5:1 on the
// card. The dot carries the bright accent.
const MISSING_INK = "text-[hsl(24_80%_34%)]";

const BOOKING_STEP_LINE: Partial<Record<SetupStepId, TranslationKey>> = {
  services: "setupBookingStepServices",
  hours: "setupBookingStepHours",
  classes: "setupBookingStepClasses",
  courses: "setupBookingStepCourses",
};

const capitalize =(s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function buildRows(
  s: DashboardSetup,
  t: (k: TranslationKey) => string,
  pl: (base: string, n: number) => string,
  lang: Lang,
): Row[] {
  // Count rows: a loaded number becomes "N things" or the empty line.
  const count = (f: Fact<number>, base: string, none: TranslationKey, required: boolean) => {
    if (f.state !== "ok") return { status: f.state as Status, mark: "none" as Mark };
    if (f.value === 0) {
      return {
        status: { text: t(none), tone: required ? "missing" : "plain" } as Status,
        mark: (required ? "missing" : "none") as Mark,
      };
    }
    return { status: { text: pl(base, f.value), tone: "plain" } as Status, mark: "done" as Mark };
  };

  // Hours.
  let hours: { status: Status; mark: Mark };
  if (s.hours.state !== "ok") {
    hours = { status: s.hours.state, mark: "none" };
  } else if (s.hours.value.mode === "monthly") {
    const h = s.hours.value;
    const text = h.defaultOpen && h.start && h.end
      ? `${t("setupHoursMonthly")} · ${ltr(`${h.start}–${h.end}`)}`
      : t("setupHoursMonthlyChosen");
    hours = h.hasOpenDay
      ? { status: { text, tone: "plain" }, mark: "done" }
      : { status: { text: t("setupHoursNone"), tone: "missing" }, mark: "missing" };
  } else {
    const sum = s.hours.value.summary;
    const day = (d: number) => t(`setupDay${d}` as TranslationKey);
    if (sum.kind === "none") {
      hours = { status: { text: t("setupHoursNone"), tone: "missing" }, mark: "missing" };
    } else if (sum.kind === "mixed") {
      hours = { status: { text: pl("setupHoursMixed", sum.openDays), tone: "plain" }, mark: "done" };
    } else {
      const days = sum.runs
        .map(([a, b]) => (a === b ? day(a) : `${day(a)}–${day(b)}`))
        .join(lang === "ar" ? "، " : ", ");
      hours = { status: { text: `${days} · ${ltr(`${sum.start}–${sum.end}`)}`, tone: "plain" }, mark: "done" };
    }
  }

  // Profile: list what is missing from the required pair, else what is there.
  const p = s.profile;
  const missing = [
    !p.hasAvatar && t("setupItemAvatar"),
    !p.hasAbout && t("setupItemAbout"),
  ].filter(Boolean) as string[];
  const present = [
    p.hasAvatar && t("setupItemAvatar"),
    p.hasCover && t("setupItemCover"),
    p.hasAbout && t("setupItemAbout"),
  ].filter(Boolean) as string[];
  const profile: { status: Status; mark: Mark } = missing.length
    ? {
        status: { text: t("setupProfileMissing").replace("{items}", joinList(lang, missing)), tone: "missing" },
        mark: "missing",
      }
    : { status: { text: capitalize(joinList(lang, present)), tone: "plain" }, mark: "done" };

  const booking: Status = {
    text: `${t(s.booking.requiresApproval ? "setupBookingManual" : "setupBookingAuto")} · ${pl("setupBookingWindow", s.booking.windowDays)}`,
    tone: "plain",
  };

  const section = (id: SectionId): StepTarget => ({ kind: "section", section: id });

  if (s.isAcademy) {
    // Pending requests wait on the provider, so a non-zero count is shown in
    // the "missing" ink (no mark: it is not a setup step).
    const pending: Status = s.pendingRegistrations.state !== "ok"
      ? s.pendingRegistrations.state
      : s.pendingRegistrations.value > 0
        ? { text: pl("setupRegistrationsPending", s.pendingRegistrations.value), tone: "missing" }
        : { text: t("setupRegistrationsNonePending"), tone: "plain" };
    return [
      { key: "courses", icon: BookOpen, label: "setupRowCourses", target: section("courses"),
        ...count(s.courses, "setupCourses", "setupCoursesNone", true) },
      { key: "registrations", icon: ClipboardList, label: "setupRowRegistrations", target: section("registrations"),
        status: pending, mark: "none" },
      { key: "instructors", icon: GraduationCap, label: "setupRowInstructors", target: { kind: "instructors" },
        ...count(s.instructors, "setupInstructors", "setupInstructorsNone", false) },
      { key: "profile", icon: Store, label: "setupRowProfile", target: section("profile"), ...profile },
      { key: "photos", icon: Images, label: "setupRowPhotos", target: section("photos"),
        ...count(s.photos, "setupPhotos", "setupPhotosNone", false) },
      { key: "booking", icon: SlidersHorizontal, label: "setupRowBooking", target: section("booking"),
        status: booking, mark: "none" },
    ];
  }

  if (s.isFitnessStudio) {
    return [
      { key: "classes", icon: CalendarDays, label: "setupRowClasses", target: { kind: "classSchedule" },
        ...count(s.classes, "setupClasses", "setupClassesNone", true) },
      { key: "profile", icon: Store, label: "setupRowProfile", target: section("profile"), ...profile },
      { key: "closedDays", icon: CalendarOff, label: "setupRowClosedDays", target: section("hours"),
        // Closed days are informational: no mark either way.
        ...(() => { const c = count(s.closedDays, "setupClosedDays", "setupClosedDaysNone", false); return { ...c, mark: "none" as Mark }; })() },
      { key: "photos", icon: Images, label: "setupRowPhotos", target: section("photos"),
        ...count(s.photos, "setupPhotos", "setupPhotosNone", false) },
      { key: "packages", icon: Ticket, label: "setupRowPackages", target: section("packages"),
        ...count(s.packages, "setupPackages", "setupPackagesNone", false) },
      { key: "booking", icon: SlidersHorizontal, label: "setupRowBooking", target: section("booking"),
        status: booking, mark: "none" },
    ];
  }
  return [
    { key: "services", icon: Briefcase, label: "setupRowServices", target: section("services"),
      ...count(s.services, "setupServices", "setupServicesNone", true) },
    { key: "hours", icon: Clock, label: "setupRowHours", target: section("hours"), ...hours },
    { key: "profile", icon: Store, label: "setupRowProfile", target: section("profile"), ...profile },
    { key: "photos", icon: Images, label: "setupRowPhotos", target: section("photos"),
      ...count(s.photos, "setupPhotos", "setupPhotosNone", false) },
    { key: "booking", icon: SlidersHorizontal, label: "setupRowBooking", target: section("booking"),
      status: booking, mark: "none" },
  ];
}

export function SetupHub({ onOpen }: { onOpen: (target: StepTarget) => void }) {
  const { t, lang } = useLang();
  const pl = usePlural();
  const setup = useDashboardSetup();
  if (!setup) return null;

  const rows = buildRows(setup, t, pl, lang as Lang);
  const steps = setup.steps;
  const message = steps ? progressMessage(steps) : null;

  return (
    <div className="space-y-4">
      {steps && message && (
        <ProgressCard
          percent={setupPercent(steps)}
          segments={steps.map((s) => s.done)}
          // A missing booking step is named ("Add a service so customers can
          // book"); with only photo/description missing the business is
          // already bookable, so the line talks about the profile instead.
          stepsLeft={
            message.kind === "booking"
              ? t(BOOKING_STEP_LINE[message.step] ?? "setupBookingStepServices")
              : pl("setupProfileStepsLeft", message.remaining)
          }
          // LTR isolate: in Arabic the digits otherwise resolve as Arabic
          // numbers and the % sign jumps to their other side ("%25").
          title={t("setupProgressTitle").replace("{p}", ltr(`${setupPercent(steps)}%`))}
          onOpen={() => onOpen(stepTarget(message.step))}
        />
      )}

      <ul className="glass-card-md overflow-hidden rounded-3xl">
        {rows.map((row, i) => (
          <li key={row.key} className={i > 0 ? "border-t border-foreground/[0.07]" : undefined}>
            <HubRow row={row} label={t(row.label)} t={t} onOpen={() => onOpen(row.target)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgressCard({
  percent, segments, title, stepsLeft, onOpen,
}: {
  percent: number;
  segments: boolean[];
  title: string;
  stepsLeft: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card block w-full rounded-3xl p-4 text-start transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{title}</span>
        <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/50" />
      </span>
      {/* One segment per required step, in hub order, so the bar shows WHICH
          steps are done — not just how many. */}
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={title}
        className="mt-3 flex gap-1.5"
      >
        {segments.map((done, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${done ? "bg-accent" : "bg-accent/15"}`}
          />
        ))}
      </span>
      <span className="mt-2.5 block text-xs leading-relaxed text-foreground/70">{stepsLeft}</span>
    </button>
  );
}

function HubRow({
  row, label, t, onOpen,
}: {
  row: Row;
  label: string;
  t: (k: TranslationKey) => string;
  onOpen: () => void;
}) {
  const Icon = row.icon;
  const status = row.status;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{label}</span>
        {status === "loading" ? (
          <span aria-hidden className="mt-1.5 block h-2.5 w-28 rounded-full bg-foreground/10 motion-safe:animate-pulse" />
        ) : status === "error" ? (
          <span className="mt-0.5 block truncate text-xs text-foreground/60">{t("setupStatusError")}</span>
        ) : (
          // Two lines, not truncate: "Missing: profile picture and description"
          // is the whole point of the line and runs long in Arabic.
          <span
            className={`mt-0.5 line-clamp-2 text-xs leading-snug ${status.tone === "missing" ? `font-medium ${MISSING_INK}` : "text-foreground/70"}`}
          >
            {status.text}
          </span>
        )}
      </span>
      {/* Fixed-width slot so chevrons line up whether or not a row has a mark. */}
      <span className="flex w-5 shrink-0 justify-center">
        {row.mark === "done" && (
          <span
            role="img"
            aria-label={t("setupMarkDone")}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15"
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
        {row.mark === "missing" && (
          <span
            role="img"
            aria-label={t("setupMarkMissing")}
            className="h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-accent/15"
          />
        )}
      </span>
      <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
    </button>
  );
}
