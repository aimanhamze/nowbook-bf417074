// ─────────────────────────────────────────────────────────────────────────────
// Hand-written types for the academy tables and RPCs (feat/academy-courses).
//
// WHY THIS FILE EXISTS — and when to delete it.
//
// `types.ts` is generated from PROD, which is the real record of the live
// schema (it carries PROD-only objects that DEV lacks). The academy tables
// exist on DEV only until the Phase 1 migrations
// (supabase/migrations/20261108000001…000007) are applied to PROD, so
// regenerating types.ts from DEV would add these tables at the cost of
// deleting PROD-only entries. Same situation, and same answer, as
// packageTypes.ts.
//
// REPLACE THIS FILE once the academy migrations ship to PROD and `types.ts`
// is regenerated from there: switch call sites to `supabase.from(...)` /
// `Tables<"academy_courses">` and delete `academyFrom` / `academyRpc`.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "./client";

export type CourseLocationType = "physical" | "online";
export type CourseRegistrationStatus = "pending" | "confirmed" | "rejected" | "cancelled";

/** public.academy_instructors — display-only people; no contact details by design. */
export interface AcademyInstructorRow {
  id: string;
  provider_id: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

/** public.academy_courses */
export interface AcademyCourseRow {
  id: string;
  provider_id: string;
  instructor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  location_type: CourseLocationType;
  address: string | null;
  online_url: string | null;
  /** numeric(10,2); PostgREST returns it as a number. Display only. */
  price: number | null;
  max_seats: number;
  cancellation_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * public.academy_course_sessions. `provider_id` and `instructor_id` are copied
 * from the course by a trigger on insert (client values are overwritten), and
 * `period` is a generated tsrange — never send either on insert/update.
 */
export interface AcademyCourseSessionRow {
  id: string;
  course_id: string;
  provider_id: string;
  instructor_id: string;
  /** YYYY-MM-DD, Asia/Jerusalem wall-clock date. */
  session_date: string;
  /** HH:MM:SS */
  start_time: string;
  /** HH:MM:SS, always after start_time on the same date. */
  end_time: string;
  period: string | null;
  created_at: string;
}

/** public.course_registrations — read-only for clients; written by RPCs only. */
export interface CourseRegistrationRow {
  id: string;
  course_id: string;
  provider_id: string;
  user_id: string;
  status: CourseRegistrationStatus;
  cancelled_by: "customer" | "provider" | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AcademyInstructorInsert = Pick<AcademyInstructorRow, "provider_id" | "name"> &
  Partial<Pick<AcademyInstructorRow, "bio" | "photo_url" | "is_active" | "display_order">>;
export type AcademyInstructorUpdate = Partial<Pick<AcademyInstructorRow, "name" | "bio" | "photo_url" | "is_active" | "display_order">>;

export type AcademyCourseWrite = Pick<
  AcademyCourseRow,
  | "instructor_id"
  | "name"
  | "description"
  | "location_type"
  | "address"
  | "online_url"
  | "price"
  | "max_seats"
  | "cancellation_hours"
  | "is_active"
>;

export type AcademySessionWrite = Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time">;

type AcademyTable =
  | "academy_instructors"
  | "academy_courses"
  | "academy_course_sessions"
  | "course_registrations";

/**
 * Query builder for the academy tables. The cast is confined here; every call
 * site annotates its result with the row interfaces above, so nothing
 * downstream is `any`. course_registrations has no client write path — use the
 * registration RPCs (Phase 4) for that.
 */
export function academyFrom(table: AcademyTable) {
  return (supabase as unknown as {
    from: (t: AcademyTable) => ReturnType<typeof supabase.from<never>>;
  }).from(table);
}

/** Typed wrapper for the academy RPCs (customer/provider registration flow). */
export function academyRpc(
  fn:
    | "register_for_course"
    | "cancel_course_registration"
    | "decide_course_registration"
    | "get_course_seat_counts",
  args: Record<string, unknown>,
) {
  return (supabase as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{
      data: unknown;
      error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
      status?: number;
    }>;
  }).rpc(fn, args);
}
