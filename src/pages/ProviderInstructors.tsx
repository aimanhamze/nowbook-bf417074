import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { GraduationCap, Plus } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { ProviderPageTitle } from "@/components/branch/ProviderPageTitle";
import { InstructorRoster } from "@/components/academy/InstructorRoster";
import { isAcademyCategory } from "@/lib/academyCategory";
import { useInstructorsNav } from "@/components/academy/instructorNav";
import { sectionTransition } from "@/components/dashboard/sectionTransition";
import { LIST } from "@/components/dashboard/settingsList";
import { cn } from "@/lib/utils";

/**
 * /instructors — an academy branch's instructor roster. The academy twin of
 * /staff: list only, tapping a row opens /instructors/:id. Non-academy
 * providers are sent back to /profile (the page has nothing for them).
 */
export default function ProviderInstructors() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const nav = useInstructorsNav();
  const reduceMotion = useReducedMotion();
  const { profile, isLoading: profileLoading } = useProviderProfile();
  const { instructors, activeInstructors, isLoading } = useAcademyInstructors();
  const { courses } = useAcademyCourses();
  // "Active courses" = academy_courses.is_active, the same rule as the setup
  // hub, so the numbers match everywhere (ticket: ended-but-active courses).
  const activeCourses = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of courses) if (c.is_active) map.set(c.instructor_id, (map.get(c.instructor_id) ?? 0) + 1);
    return map;
  }, [courses]);

  useEffect(() => {
    if (user && !isProvider) navigate("/", { replace: true });
  }, [user, isProvider, navigate]);

  useEffect(() => {
    if (profile && !isAcademyCategory(profile.category)) navigate("/profile", { replace: true });
  }, [profile, navigate]);

  if (!user || !isProvider) return null;

  if (!profileLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  const hasInstructors = instructors.length > 0;

  return (
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        <header className="flex items-center gap-3 px-5 pt-12 pb-4">
          <button onClick={nav.backFromList} className="-ms-3 flex h-11 w-11 items-center justify-center rounded-xl active:scale-95" aria-label={t(nav.isEntry ? "dashboard" : "back")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <ProviderPageTitle className="flex-1 text-xl font-bold">{t("academyInstructorsTitle")}</ProviderPageTitle>
          {/* Active only: matches the list above the fold; inactive ones are
              counted in their own "Inactive (n)" group. */}
          {activeInstructors.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
              <bdi>{activeInstructors.length}</bdi>
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => nav.openFromList("new")} className="h-11 gap-1.5 rounded-2xl">
            <Plus className="h-4 w-4" />
            {t("academyInstructorAdd")}
          </Button>
        </header>

        {/* The dashboard section's open transition (reduced motion: fade only). */}
        <motion.div {...sectionTransition(!!reduceMotion)} className="px-5">
          {isLoading || profileLoading ? (
            <div className={cn(LIST, "space-y-px")}>
              {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-foreground/[0.04]" />)}
            </div>
          ) : !hasInstructors ? (
            <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <GraduationCap className="h-6 w-6" />
              </span>
              <p className="mt-3 font-semibold">{t("academyInstructorsEmptyTitle")}</p>
              <p className="mt-1 text-sm text-foreground/60">{t("academyInstructorsEmptyBody")}</p>
            </section>
          ) : (
            <InstructorRoster
              instructors={instructors}
              activeCourses={activeCourses}
              onOpen={nav.openFromList}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}
