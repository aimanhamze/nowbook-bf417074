export interface ProviderHours {
  open: string;
  close: string;
}

export interface ProviderStatus {
  isOpen: boolean;
  todayHours: ProviderHours | null;
  hasSchedule: boolean;
}

export interface AvailabilityRow {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
}

/** The provider_date_overrides fields the pill reads. */
export interface StatusOverrideRow {
  override_date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const sliced = value.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(sliced) ? sliced : null;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function todayDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The open/closed pill. Same precedence as resolveDayHours:
 * blocked -> date override -> weekday row.
 *
 * `overrides` is optional; omitted or empty gives the old result exactly.
 * A provider with no weekday rows but an override for today counts as having a
 * schedule today, so its special opening still shows.
 */
export function getProviderStatus(
  availability: AvailabilityRow[] | null | undefined,
  blockedDates: string[] | null | undefined,
  now: Date,
  overrides?: StatusOverrideRow[] | null,
): ProviderStatus {
  const today = todayDateString(now);
  const override = overrides?.find(o => o.override_date.slice(0, 10) === today);

  const hasSchedule = (availability?.length ?? 0) > 0 || !!override;
  if (!hasSchedule) {
    return { isOpen: false, todayHours: null, hasSchedule: false };
  }

  if (blockedDates?.includes(today)) {
    return { isOpen: false, todayHours: null, hasSchedule: true };
  }

  const row = override ?? availability!.find(r => r.day_of_week === now.getDay());
  if (!row || !row.is_available) {
    return { isOpen: false, todayHours: null, hasSchedule: true };
  }

  const open = normalizeTime(row.start_time);
  const close = normalizeTime(row.end_time);
  if (!open || !close) {
    return { isOpen: false, todayHours: null, hasSchedule: true };
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isOpen = nowMins >= toMinutes(open) && nowMins < toMinutes(close);

  return { isOpen, todayHours: { open, close }, hasSchedule: true };
}
