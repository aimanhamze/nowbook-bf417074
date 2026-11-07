import type { TranslationKey } from "@/lib/translations";
import { supabaseErrorCode } from "@/lib/supabaseError";

/**
 * Friendly messages for what the academy tables, triggers and the category
 * guard raise. The database is the source of truth for every rule (overlap,
 * inactive instructor, location consistency, seats...), so the UI does not
 * re-implement them: it lets the write fail and translates the failure.
 *
 * What the DB sends (PostgREST error body: code / message / details):
 *   23P01  exclusion_violation   academy_course_sessions_no_instructor_overlap
 *   23514  check_violation       message 'academy_instructor_inactive' (course trigger)
 *   23514  check_violation       'violates check constraint "<name>"'
 *   P0001  raise_exception       'CATEGORY_CHANGE_BLOCKED', details '<n> live course registration(s) …'
 *   23503  foreign_key_violation composite FK (instructor from another branch)
 *   42501  insufficient_privilege RLS WITH CHECK (e.g. branch is not 'academy')
 * plus the client-side image checks (IMAGE_INVALID_TYPE / IMAGE_TOO_LARGE).
 */

export type AcademyErrorKey = Extract<TranslationKey, `academyErr${string}`>;

export interface AcademyErrorInfo {
  key: AcademyErrorKey;
  /** Placeholder values for the message, e.g. { n: "3" }. */
  params?: Record<string, string>;
}

function field(err: unknown, name: "message" | "details"): string {
  if (typeof err === "string") return name === "message" ? err : "";
  if (typeof err === "object" && err !== null) {
    const v = (err as Record<string, unknown>)[name];
    if (typeof v === "string") return v;
  }
  return "";
}

/** The constraint name Postgres quotes in a check_violation message, if any. */
function constraintName(message: string): string {
  const m = message.match(/constraint "([^"]+)"/);
  return m ? m[1] : "";
}

function checkViolationKey(name: string): AcademyErrorKey {
  if (name.includes("location")) return "academyErrLocation";
  if (name.includes("end_after_start")) return "academyErrSessionTimes";
  if (name.includes("max_seats")) return "academyErrSeats";
  if (name.includes("price")) return "academyErrPrice";
  if (name.includes("cancellation_hours")) return "academyErrCancelHours";
  if (name.endsWith("name_check")) return "academyErrName";
  if (name.endsWith("bio_check") || name.endsWith("description_check")) return "academyErrTooLong";
  return "academyErrInvalid";
}

export function academyErrorInfo(err: unknown): AcademyErrorInfo {
  const code = supabaseErrorCode(err);
  const message = field(err, "message");
  const details = field(err, "details");

  // Named raises first: their SQLSTATE is a generic class.
  if (message.includes("CATEGORY_CHANGE_BLOCKED")) {
    const n = details.match(/^\s*(\d+)/)?.[1] ?? "";
    return { key: "academyErrCategoryBlocked", params: { n } };
  }
  if (message.includes("academy_instructor_inactive")) return { key: "academyErrInstructorInactive" };
  if (message.includes("IMAGE_INVALID_TYPE")) return { key: "academyErrImageType" };
  if (message.includes("IMAGE_TOO_LARGE")) return { key: "academyErrImageSize" };
  if (message.includes("academy_course_not_found")) return { key: "academyErrGeneric" };

  switch (code) {
    case "23P01":
      return { key: "academyErrInstructorBusy" };
    case "23514":
      return { key: checkViolationKey(constraintName(message)) };
    case "23503":
      return { key: "academyErrInstructorMismatch" };
    case "42501":
      return { key: "academyErrNotAllowed" };
    case "22001":
      return { key: "academyErrTooLong" };
    case "22P02":
    case "22007":
    case "22008":
    case "23502":
      return { key: "academyErrInvalid" };
    default:
      return { key: "academyErrGeneric" };
  }
}

/** academyErrorInfo, rendered through `t` with its placeholders filled. */
export function academyErrorMessage(err: unknown, t: (key: TranslationKey) => string): string {
  const { key, params } = academyErrorInfo(err);
  let text = t(key);
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.split(`{${name}}`).join(value);
  }
  return text;
}
