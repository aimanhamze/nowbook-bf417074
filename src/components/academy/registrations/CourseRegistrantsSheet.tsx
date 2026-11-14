import { useState } from "react";
import { Users } from "lucide-react";
import { EditSheet, SettingsGroup } from "@/components/dashboard/SettingsRows";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseRow } from "@/integrations/supabase/academyTypes";
import { useAcademyRegistrations, type RegistrationsScope } from "@/hooks/useAcademyRegistrations";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { courseRegistrants } from "@/lib/academyRegistrations";
import { courseSpan } from "@/lib/academyCustomer";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { RegistrantRow } from "./RegistrantRow";
import { RegistrationSheet } from "./RegistrationSheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: AcademyCourseRow | null;
  /** Extra line under the title, e.g. the tapped session's date and time. */
  subtitle?: React.ReactNode;
  /**
   * Which registrations query to read. Pass the SAME scope the caller already
   * uses (the calendar passes its range's course ids) so the sheet shares that
   * cache entry. Omitted = the whole branch.
   */
  scope?: RegistrationsScope;
}

/**
 * Who holds a seat in one course (pending + confirmed, confirmed first) with
 * seats taken / max, as compact rows. Tapping a row opens RegistrationSheet
 * (approve / decline / cancel / WhatsApp / call) on top of this sheet; it
 * reads the same scope, so the change shows here, in the tab, the badge and
 * the calendar together.
 */
export function CourseRegistrantsSheet({ open, onOpenChange, course, subtitle, scope }: Props) {
  const { t, lang } = useLang();
  const { registrations, isLoading } = useAcademyRegistrations(scope);
  const { sessionsByCourse } = useAcademyCourses();
  const [openId, setOpenId] = useState<string | null>(null);

  const list = course ? courseRegistrants(registrations, course.id) : [];
  const span = courseSpan(course ? sessionsByCourse.get(course.id) ?? [] : []);
  const dates =
    span.first && span.last ? compactDateRange(span.first.session_date, span.last.session_date, dateFnsLocaleFor(lang)) : null;

  return (
    <>
      <EditSheet
        open={open}
        onClose={() => onOpenChange(false)}
        icon={Users}
        title={t("academyRegistrants")}
        description={
          course ? (
            <>
              <bdi>{course.name}</bdi>
              {subtitle && <> · {subtitle}</>}
            </>
          ) : undefined
        }
      >
        {course && (
          <p className="px-1 text-sm font-medium text-foreground/70">
            {t("academySeatsTaken").replace("{taken}", String(list.length)).replace("{max}", String(course.max_seats))}
          </p>
        )}
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-foreground/[0.04]" />
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground/60">{t("academyNoRegistrants")}</p>
        ) : (
          <SettingsGroup plain>
            {list.map((r) => (
              <RegistrantRow key={r.id} registration={r} onOpen={() => setOpenId(r.id)} />
            ))}
          </SettingsGroup>
        )}
      </EditSheet>

      <RegistrationSheet
        registrationId={open ? openId : null}
        onClose={() => setOpenId(null)}
        course={course}
        courseDates={dates}
        scope={scope}
      />
    </>
  );
}
