// Pure logic behind the provider dashboard's setup hub (src/pages/Dashboard.tsx
// + src/components/dashboard/SetupHub.tsx). No React, no Supabase: everything
// here is derived from rows the dashboard already loads, so it is unit-tested
// in isolation (dashboardSetup.test.ts).

import type { Lang } from "@/lib/translations";

// ── Sections ────────────────────────────────────────────────────────────────

/** A section the hub can open in place, addressed by `/dashboard?section=<id>`. */
export type SectionId =
  | "services" | "hours" | "profile" | "photos" | "booking" | "packages"
  | "courses" | "registrations";

export const SECTION_IDS: readonly SectionId[] = [
  "services", "hours", "profile", "photos", "booking", "packages", "courses", "registrations",
];

// The old tab ids, still sent as navigate("/dashboard", { state: { tab } }) —
// CalendarTab's "no services" card does exactly that. Mapped onto sections so
// those links keep landing in the right place.
const LEGACY_TAB_TO_SECTION: Record<string, SectionId> = {
  services: "services",
  availability: "hours",
  profile: "profile",
  gallery: "photos",
  booking: "booking",
  packages: "packages",
  courses: "courses",
  registrations: "registrations",
};

/** Parses a `?section=` value or a legacy `state.tab` id. Unknown → null (hub). */
export function toSectionId(value: string | null | undefined): SectionId | null {
  if (!value) return null;
  if ((SECTION_IDS as readonly string[]).includes(value)) return value as SectionId;
  return LEGACY_TAB_TO_SECTION[value] ?? null;
}

/**
 * Whether this provider type has the section at all. A fitness studio has no
 * services section (its classes live in provider_class_schedule, edited from
 * /calendar) and is the only type with packages. `hours` stays for a studio:
 * AvailabilityTab shows it only the blocked-dates card, its one way to close a day.
 *
 * An academy runs on courses (academy_courses + sessions), not on services,
 * weekly hours or packages: it has "courses" and "registrations" instead, and
 * is the only type that has them.
 */
export function isSectionVisible(section: SectionId, isFitnessStudio: boolean, isAcademy = false): boolean {
  if (section === "courses" || section === "registrations") return isAcademy;
  if (isAcademy) return section !== "services" && section !== "hours" && section !== "packages";
  if (section === "services") return !isFitnessStudio;
  if (section === "packages") return isFitnessStudio;
  return true;
}

// ── Completeness ────────────────────────────────────────────────────────────

/**
 * The required steps, in hub order. A regular provider needs an active
 * service, an open day, a profile photo and a description. For a fitness
 * studio the weekly class schedule is both its services and its hours, so it
 * counts once: classes, profile photo, description. An academy needs an
 * active course (customers register for courses), a profile photo and a
 * description.
 */
export type SetupStepId = "services" | "hours" | "classes" | "courses" | "avatar" | "about";

export interface SetupInputs {
  isFitnessStudio: boolean;
  activeServiceCount: number;
  hasOpenDay: boolean;
  classCount: number;
  hasAvatar: boolean;
  hasAbout: boolean;
  /** Academy branch; takes precedence over the other provider types. */
  isAcademy?: boolean;
  activeCourseCount?: number;
}

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
}

export function getSetupSteps(i: SetupInputs): SetupStep[] {
  const profileSteps: SetupStep[] = [
    { id: "avatar", done: i.hasAvatar },
    { id: "about", done: i.hasAbout },
  ];
  if (i.isAcademy) {
    return [{ id: "courses", done: (i.activeCourseCount ?? 0) > 0 }, ...profileSteps];
  }
  if (i.isFitnessStudio) {
    return [{ id: "classes", done: i.classCount > 0 }, ...profileSteps];
  }
  return [
    { id: "services", done: i.activeServiceCount > 0 },
    { id: "hours", done: i.hasOpenDay },
    ...profileSteps,
  ];
}

export function setupPercent(steps: SetupStep[]): number {
  if (steps.length === 0) return 100;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}

/**
 * Steps without which customers cannot book at all: no service (or, for a
 * studio, no class) means nothing to book, and no open day means no slots.
 * Profile photo and description only make the page complete; a provider
 * missing just those is already bookable.
 */
const BOOKING_STEPS: readonly SetupStepId[] = ["services", "hours", "classes", "courses"];

export function blocksBooking(step: SetupStepId): boolean {
  return BOOKING_STEPS.includes(step);
}

/**
 * What the progress card's second line says, and where tapping it goes. A
 * missing booking step wins and is named, so the card never claims customers
 * can't book when they can, nor hides that they can't.
 */
export type ProgressMessage =
  | { kind: "booking"; step: SetupStepId }
  | { kind: "profile"; remaining: number; step: SetupStepId };

export function progressMessage(steps: SetupStep[]): ProgressMessage | null {
  const missing = steps.filter((s) => !s.done);
  if (missing.length === 0) return null;
  const booking = missing.find((s) => blocksBooking(s.id));
  if (booking) return { kind: "booking", step: booking.id };
  return { kind: "profile", remaining: missing.length, step: missing[0].id };
}

/** Where a hub row or a missing step leads: a dashboard section, /calendar
 *  for a studio's classes, or the academy's /instructors roster. */
export type StepTarget =
  | { kind: "section"; section: SectionId }
  | { kind: "classSchedule" }
  | { kind: "instructors" };

export function stepTarget(step: SetupStepId): StepTarget {
  switch (step) {
    case "services": return { kind: "section", section: "services" };
    case "hours": return { kind: "section", section: "hours" };
    case "classes": return { kind: "classSchedule" };
    case "courses": return { kind: "section", section: "courses" };
    case "avatar":
    case "about": return { kind: "section", section: "profile" };
  }
}

// ── Opening hours summary ───────────────────────────────────────────────────

export interface WeeklyRow {
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
}

export type HoursSummary =
  | { kind: "none" }
  /** Every open day shares one window; `runs` are consecutive day ranges (0 = Sunday). */
  | { kind: "uniform"; runs: Array<[number, number]>; start: string; end: string }
  /** Open days with different windows — summarised as a count. */
  | { kind: "mixed"; openDays: number };

const hhmm = (time: string) => time.slice(0, 5);

export function summarizeWeeklyHours(rows: WeeklyRow[]): HoursSummary {
  const open = rows
    .filter((r) => r.is_available)
    .sort((a, b) => a.day_of_week - b.day_of_week);
  if (open.length === 0) return { kind: "none" };

  const start = hhmm(open[0].start_time);
  const end = hhmm(open[0].end_time);
  const uniform = open.every((r) => hhmm(r.start_time) === start && hhmm(r.end_time) === end);
  if (!uniform) return { kind: "mixed", openDays: open.length };

  const runs: Array<[number, number]> = [];
  for (const r of open) {
    const last = runs[runs.length - 1];
    if (last && r.day_of_week === last[1] + 1) last[1] = r.day_of_week;
    else runs.push([r.day_of_week, r.day_of_week]);
  }
  return { kind: "uniform", runs, start, end };
}

// ── Plurals and lists ───────────────────────────────────────────────────────

/**
 * Plural forms keyed by CLDR category. Arabic needs one/two/few/many; Hebrew
 * and English get by with one/other. Missing categories fall back to `other`.
 * `{n}` in the chosen form is replaced by the number.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export function plural(lang: Lang, n: number, forms: PluralForms): string {
  let category: Intl.LDMLPluralRule = "other";
  try {
    category = new Intl.PluralRules(lang).select(n);
  } catch {
    category = n === 1 ? "one" : "other";
  }
  return (forms[category] ?? forms.other).replace("{n}", String(n));
}

/** "a, b and c" in the active language (Intl.ListFormat), with a plain fallback. */
export function joinList(lang: Lang, items: string[]): string {
  // Intl.ListFormat is ES2021; tsconfig targets ES2020 typings, hence the cast.
  const ListFormat = (Intl as unknown as {
    ListFormat?: new (l: string, o: object) => { format(items: string[]): string };
  }).ListFormat;
  try {
    if (!ListFormat) throw new Error("no ListFormat");
    return new ListFormat(lang, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(lang === "ar" ? "، " : ", ");
  }
}

/** Wraps text in a left-to-right isolate (LRI…PDI) so "09:00–17:00" does not
 *  render reversed inside a right-to-left sentence. */
export const ltr = (s: string) => `⁦${s}⁩`;
