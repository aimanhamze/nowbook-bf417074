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

export function getProviderStatus(
  availability: AvailabilityRow[] | null | undefined,
  blockedDates: string[] | null | undefined,
  now: Date,
): ProviderStatus {
  const hasSchedule = (availability?.length ?? 0) > 0;
  if (!hasSchedule) {
    return { isOpen: false, todayHours: null, hasSchedule: false };
  }

  if (blockedDates?.includes(todayDateString(now))) {
    return { isOpen: false, todayHours: null, hasSchedule: true };
  }

  const row = availability!.find(r => r.day_of_week === now.getDay());
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
