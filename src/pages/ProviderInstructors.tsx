import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { GraduationCap, Plus } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { ProviderPageTitle } from "@/components/branch/ProviderPageTitle";
import { InstructorRoster } from "@/components/academy/InstructorRoster";
import { isAcademyCategory } from "@/lib/academyCategory";

/**
 * /instructors — an academy branch's instructor roster. The academy twin of
 * /staff: list only, tapping a row opens /instructors/:id. Non-academy
 * providers are sent back to /profile (the page has nothing for them).
 */
export default function ProviderInstructors() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading } = useProviderProfile();
  const { instructors, isLoading } = useAcademyInstructors();

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
          <button onClick={() => navigate("/profile")} className="-ms-1.5 rounded-xl p-1.5 active:scale-95" aria-label={t("profile")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <ProviderPageTitle className="flex-1 text-xl font-bold">{t("academyInstructorsTitle")}</ProviderPageTitle>
          {hasInstructors && (
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
              <bdi>{instructors.length}</bdi>
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate("/instructors/new")} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("academyInstructorAdd")}
          </Button>
        </header>

        <div className="flex flex-col gap-3.5 px-5">
          {isLoading || profileLoading ? (
            [0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-2xl bg-secondary animate-pulse" />)
          ) : !hasInstructors ? (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card rounded-3xl px-6 py-8 text-center"
            >
              <span className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-accent/10 text-accent">
                <GraduationCap className="h-11 w-11" strokeWidth={1.5} />
              </span>
              <h2 className="mb-2 text-xl font-bold">{t("academyInstructorsEmptyTitle")}</h2>
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t("academyInstructorsEmptyBody")}</p>
              <Button onClick={() => navigate("/instructors/new")} className="h-12 w-full gap-2 text-base">
                <Plus className="h-5 w-5" />
                {t("academyInstructorAdd")}
              </Button>
            </motion.section>
          ) : (
            <InstructorRoster instructors={instructors} onOpen={(id) => navigate(`/instructors/${id}`)} />
          )}
        </div>
      </div>
    </div>
  );
}
