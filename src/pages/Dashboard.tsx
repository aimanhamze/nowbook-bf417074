import { useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { BackArrow, BackOrHomeIcon } from "@/components/ui/directional-icon";
import { useSmartBack } from "@/hooks/useSmartBack";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useActiveBranchId } from "@/lib/activeBranch";
import { BranchChip } from "@/components/branch/BranchChip";
import { ServicesTab } from "@/components/dashboard/ServicesTab";
import { BusinessProfileTab } from "@/components/dashboard/BusinessProfileTab";
import { BookingSettingsTab } from "@/components/dashboard/BookingSettingsTab";
import { AvailabilityTab } from "@/components/dashboard/AvailabilityTab";
import { PhotosTab } from "@/components/dashboard/PhotosTab";
import { PackagesTab } from "@/components/dashboard/PackagesTab";
import { CoursesTab } from "@/components/academy/CoursesTab";
import { RegistrationsTab } from "@/components/academy/registrations/RegistrationsTab";
import { isAcademyCategory } from "@/lib/academyCategory";
import { SetupHub } from "@/components/dashboard/SetupHub";
import { isSectionVisible, toSectionId, type SectionId, type StepTarget } from "@/lib/dashboardSetup";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";

export default function Dashboard() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const { profile, branches, isLoading } = useProviderProfile();
  // Multi-branch: the stored active-branch id keys the content below. It is
  // null — and never changes — for a single-branch owner, so their section is
  // never remounted; it changes only when a multi-branch owner switches.
  const activeBranchId = useActiveBranchId(user?.id);
  const navigate = useNavigate();
  const { isEntry, goBack } = useSmartBack();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const reduceMotion = useReducedMotion();

  // SCOPE: packages are a fitness_studio feature (group classes only); a studio
  // has no services section (its classes live in provider_class_schedule and
  // are edited from /calendar). Same exact-string gate as BookAppointment.tsx.
  // `hours` stays for a studio: AvailabilityTab hides its hours editors there
  // but keeps the blocked-dates card, a studio's only way to close a day.
  const isFitnessStudio = profile?.category === "fitness_studio";
  // An academy runs on courses: "courses" and "registrations" replace
  // services, hours and packages (rule in lib/dashboardSetup, unit-tested).
  const isAcademy = isAcademyCategory(profile?.category);

  // The hub lives at /dashboard; a section at /dashboard?section=<id>, so the
  // device back gesture returns to the hub and a reload stays in the section.
  // A section this provider type does not have (or an unknown id) is the hub.
  const requested = toSectionId(searchParams.get("section"));
  const section: SectionId | null =
    requested && isSectionVisible(requested, isFitnessStudio, isAcademy) ? requested : null;

  // Legacy deep link: navigate("/dashboard", { state: { tab: "services" } })
  // (CalendarTab's "no services" card) is rewritten in place to ?section=, so
  // the URL, the back control and a reload all agree.
  const legacyTab = (location.state as { tab?: string } | null)?.tab;
  useEffect(() => {
    if (!legacyTab || searchParams.get("section")) return;
    const target = toSectionId(legacyTab);
    navigate(target ? `/dashboard?section=${target}` : "/dashboard", {
      replace: true,
      state: { ...(location.state as object), tab: undefined },
    });
  }, [legacyTab, searchParams, location.state, navigate]);

  // Each screen starts at the top: a section opened from far down the hub, or
  // the hub after a long section.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section]);

  const openTarget = (target: StepTarget) => {
    if (target.kind === "classSchedule") {
      navigate("/calendar", { state: { tab: "schedule" } });
      return;
    }
    if (target.kind === "instructors") {
      navigate("/instructors");
      return;
    }
    navigate(`/dashboard?section=${target.section}`, { state: { fromHub: true } });
  };

  // Back from a section: step back if the hub opened it (keeps history tidy
  // and restores the hub entry); a section reached any other way — a deep
  // link, a reload — replaces itself with the hub rather than leaving the page.
  const backToHub = () => {
    if ((location.state as { fromHub?: boolean } | null)?.fromHub) navigate(-1);
    else navigate("/dashboard", { replace: true });
  };

  const { isSupported, isSubscribed, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  if (!user || !isProvider) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">{!user ? t("signInToManage") : t("providerOnly")}</p>
        <Button onClick={() => navigate(!user ? "/auth" : "/")}>{!user ? t("signInUp") : t("home")}</Button>
      </div>
    );
  }

  // If no profile yet, provider was not set up by admin
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  return (
    // Dashboard-only background: a softer, lighter take on the customer
    // atmosphere — gentler saturation, higher lightness, fading to near white.
    // Inline so the shared --bg-atmosphere (customer view) stays untouched.
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      {/* Subtle accent glow — softened/lightened for the dashboard so the page
          reads calmer. Anchored via a logical inset to stay RTL/LTR-correct. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[22rem] w-[22rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(24 95% 80% / 0.34) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        {section ? (
          // Section header: one back control that names where it goes, plus the
          // branch chip so a multi-branch owner always sees which branch they
          // are editing. The section's own h2 (inside the tab) is the title.
          <header className="px-5 pt-12">
            <button
              type="button"
              onClick={backToHub}
              className="-ms-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-foreground/80 transition-colors hover:bg-secondary/60 active:scale-95"
            >
              <BackArrow className="h-5 w-5" />
              {t("dashboard")}
            </button>
            {branches.length > 1 && (
              <div className="mt-1">
                <BranchChip />
              </div>
            )}
          </header>
        ) : (
          <header className="px-5 pt-12 pb-1">
            <div className="flex items-center gap-3">
              <button
                onClick={goBack}
                className="-ms-1.5 rounded-xl p-1.5 transition-colors hover:bg-secondary/60 active:scale-95"
                aria-label={t(isEntry ? "home" : "back")}
              >
                <BackOrHomeIcon home={isEntry} className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-extrabold leading-tight">{t("providerDashboard")}</h1>
                {branches.length > 1 ? (
                  <BranchChip />
                ) : (
                  profile?.business_name && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.business_name}</p>
                  )
                )}
              </div>
              {isSupported && (
                <button
                  onClick={isSubscribed ? unsubscribe : subscribe}
                  disabled={pushLoading}
                  className={`shrink-0 rounded-xl p-2.5 transition-colors active:scale-95 ${
                    isSubscribed ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                  title={isSubscribed ? t("notificationsActive") : t("enableNotifications")}
                  aria-label={isSubscribed ? t("notificationsActive") : t("enableNotifications")}
                >
                  {isSubscribed ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
                </button>
              )}
            </div>
          </header>
        )}

        {/* Keyed on branch AND section: switching branch remounts the open
            section (closing its sheets, dropping form state that belongs to the
            old branch) or the hub, while the section itself (URL) is kept. */}
        <motion.div
          key={`${activeBranchId ?? ""}:${section ?? "hub"}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={section ? "px-5 pt-3" : "px-5 pt-5"}
        >
          {section === null && <SetupHub onOpen={openTarget} />}
          {section === "profile" && <BusinessProfileTab />}
          {section === "booking" && <BookingSettingsTab />}
          {section === "hours" && <AvailabilityTab />}
          {section === "services" && <ServicesTab />}
          {section === "photos" && <PhotosTab />}
          {section === "packages" && <PackagesTab />}
          {section === "courses" && <CoursesTab />}
          {section === "registrations" && <RegistrationsTab />}
        </motion.div>
      </div>
    </div>
  );
}
