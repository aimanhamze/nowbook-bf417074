import { describe, it, expect } from "vitest";
import { academyErrorInfo, academyErrorMessage } from "./academyErrors";
import { translations, type TranslationKey } from "./translations";

// Payloads shaped exactly like the PostgREST error bodies the academy writes
// return (plain objects: code / message / details / hint).
const pg = (code: string, message: string, details: string | null = null) => ({ code, message, details, hint: null });

describe("academyErrorInfo", () => {
  it("23P01 overlap -> instructor is busy", () => {
    const err = pg(
      "23P01",
      'conflicting key value violates exclusion constraint "academy_course_sessions_no_instructor_overlap"',
      "Key (instructor_id, period)=(…) conflicts with existing key (…).",
    );
    expect(academyErrorInfo(err).key).toBe("academyErrInstructorBusy");
  });

  it("inactive-instructor trigger (check_violation with a named message)", () => {
    const err = pg("23514", "academy_instructor_inactive", "Instructor … is inactive or does not exist.");
    expect(academyErrorInfo(err).key).toBe("academyErrInstructorInactive");
  });

  it("CATEGORY_CHANGE_BLOCKED carries the live count from DETAIL", () => {
    const err = pg("P0001", "CATEGORY_CHANGE_BLOCKED", "3 live course registration(s) on this branch");
    expect(academyErrorInfo(err)).toEqual({ key: "academyErrCategoryBlocked", params: { n: "3" } });
  });

  it("CATEGORY_CHANGE_BLOCKED without a DETAIL still maps", () => {
    expect(academyErrorInfo(pg("P0001", "CATEGORY_CHANGE_BLOCKED")).key).toBe("academyErrCategoryBlocked");
  });

  it.each([
    ["academy_courses_location_consistency", "academyErrLocation"],
    ["academy_course_sessions_end_after_start", "academyErrSessionTimes"],
    ["academy_courses_max_seats_check", "academyErrSeats"],
    ["academy_courses_price_check", "academyErrPrice"],
    ["academy_courses_cancellation_hours_check", "academyErrCancelHours"],
    ["academy_courses_name_check", "academyErrName"],
    ["academy_instructors_name_check", "academyErrName"],
    ["academy_instructors_bio_check", "academyErrTooLong"],
    ["academy_courses_description_check", "academyErrTooLong"],
    ["academy_courses_location_type_check", "academyErrLocation"],
    ["something_else_check", "academyErrInvalid"],
  ])("check violation on %s -> %s", (constraint, key) => {
    const err = pg("23514", `new row for relation "x" violates check constraint "${constraint}"`);
    expect(academyErrorInfo(err).key).toBe(key);
  });

  it("23503 composite FK -> instructor not from this branch", () => {
    const err = pg("23503", 'insert or update on table "academy_courses" violates foreign key constraint "academy_courses_instructor_same_branch_fkey"');
    expect(academyErrorInfo(err).key).toBe("academyErrInstructorMismatch");
  });

  it("42501 RLS -> not allowed", () => {
    expect(academyErrorInfo(pg("42501", 'new row violates row-level security policy for table "academy_courses"')).key).toBe(
      "academyErrNotAllowed",
    );
  });

  it("client-side image checks", () => {
    expect(academyErrorInfo(new Error("IMAGE_INVALID_TYPE")).key).toBe("academyErrImageType");
    expect(academyErrorInfo(new Error("IMAGE_TOO_LARGE")).key).toBe("academyErrImageSize");
  });

  it.each([
    ["COURSE_FULL", "academyErrCourseFull"],
    ["ALREADY_REGISTERED", "academyErrAlreadyRegistered"],
    ["COURSE_ALREADY_STARTED", "academyErrCourseStarted"],
    ["CANNOT_REGISTER_OWN_COURSE", "academyErrOwnCourse"],
    ["COURSE_NOT_AVAILABLE", "academyErrCourseUnavailable"],
    ["COURSE_HAS_NO_SESSIONS", "academyErrNoSessions"],
    ["CANCELLATION_WINDOW_CLOSED", "academyErrWindowClosed"],
    ["REGISTRATION_NOT_ACTIVE", "academyErrRegistrationNotActive"],
    ["REGISTRATION_NOT_FOUND", "academyErrRegistrationNotFound"],
    ["NOT_AUTHENTICATED", "academyErrNotSignedIn"],
    ["REGISTRATION_NOT_PENDING", "academyErrRegistrationNotPending"],
    ["INVALID_DECISION", "academyErrInvalid"],
  ])("registration RPC %s -> %s", (message, key) => {
    expect(academyErrorInfo(pg("P0001", message)).key).toBe(key);
  });

  it("an RPC message does not collide with a longer one sharing a word", () => {
    // COURSE_ALREADY_STARTED contains "ALREADY" but is not ALREADY_REGISTERED.
    expect(academyErrorInfo(pg("P0001", "COURSE_ALREADY_STARTED")).key).toBe("academyErrCourseStarted");
  });

  it("anything unknown -> generic", () => {
    expect(academyErrorInfo(pg("XX000", "boom")).key).toBe("academyErrGeneric");
    expect(academyErrorInfo(new Error("network down")).key).toBe("academyErrGeneric");
    expect(academyErrorInfo(null).key).toBe("academyErrGeneric");
    expect(academyErrorInfo(pg("23503", "academy_course_not_found")).key).toBe("academyErrGeneric");
  });
});

describe("academyErrorMessage", () => {
  const tFor = (lang: "he" | "ar" | "en") => (key: TranslationKey) => translations[lang][key];

  it("fills {n} in every language", () => {
    const err = pg("P0001", "CATEGORY_CHANGE_BLOCKED", "2 live course registration(s) on this branch");
    for (const lang of ["he", "ar", "en"] as const) {
      const text = academyErrorMessage(err, tFor(lang));
      expect(text).toContain("2");
      expect(text).not.toContain("{n}");
    }
  });

  it("returns a real sentence, never the raw key", () => {
    const text = academyErrorMessage(pg("23P01", "x"), tFor("en"));
    expect(text).toBe(translations.en.academyErrInstructorBusy);
  });
});

describe("academy translations", () => {
  it("every academy key exists, non-empty, in he / ar / en", () => {
    const keys = Object.keys(translations.he).filter((k) => k.startsWith("academy"));
    expect(keys.length).toBeGreaterThan(50);
    for (const lang of ["ar", "en"] as const) {
      const table = translations[lang] as Record<string, string>;
      for (const k of keys) {
        expect(table[k], `${lang}.${k}`).toBeTruthy();
      }
    }
    for (const lang of ["he", "ar", "en"] as const) {
      const table = translations[lang] as Record<string, string>;
      const own = Object.keys(table).filter((k) => k.startsWith("academy"));
      expect(own.sort()).toEqual([...keys].sort());
    }
  });
});
