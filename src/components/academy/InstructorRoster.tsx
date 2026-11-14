import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { NavRow, SettingsGroup } from "@/components/dashboard/SettingsRows";
import { useLang } from "@/contexts/LangContext";
import { usePlural } from "@/hooks/usePlural";
import type { AcademyInstructorRow } from "@/integrations/supabase/academyTypes";
import { cn } from "@/lib/utils";
import { InstructorAvatar } from "./InstructorAvatar";

interface Props {
  instructors: AcademyInstructorRow[];
  /** Active courses per instructor id (academy_courses.is_active — the setup hub's rule). */
  activeCourses: Map<string, number>;
  onOpen: (id: string) => void;
}

/**
 * Same shape as the staff roster: active instructors in one grouped list,
 * inactive ones under a folded "Inactive (n)". Each row opens the instructor
 * page; its second line is the number of active courses they teach.
 */
export function InstructorRoster({ instructors, activeCourses, onOpen }: Props) {
  const { t } = useLang();
  const pl = usePlural();
  const [showInactive, setShowInactive] = useState(false);
  const active = instructors.filter((i) => i.is_active);
  const inactive = instructors.filter((i) => !i.is_active);

  const row = (i: AcademyInstructorRow) => {
    const n = activeCourses.get(i.id) ?? 0;
    return (
      <NavRow
        key={i.id}
        leading={<InstructorAvatar id={i.id} name={i.name} photoUrl={i.photo_url} muted={!i.is_active} />}
        title={<bdi className={cn(!i.is_active && "text-foreground/60")}>{i.name}</bdi>}
        description={!i.is_active ? t("academyInstructorInactive") : n > 0 ? pl("setupCourses", n) : t("acNoActiveCourses")}
        muted={!i.is_active || n === 0}
        onClick={() => onOpen(i.id)}
      />
    );
  };

  return (
    <div className="space-y-3">
      {active.length > 0 && <SettingsGroup>{active.map(row)}</SettingsGroup>}

      {inactive.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="flex min-h-11 w-full items-center gap-1.5 px-1 text-xs font-semibold text-foreground/60"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", showInactive && "rotate-180")} />
            <span>{t("academyInstructorsInactiveGroup").replace("{n}", String(inactive.length))}</span>
          </button>
          {showInactive && <SettingsGroup>{inactive.map(row)}</SettingsGroup>}
        </section>
      )}
    </div>
  );
}
