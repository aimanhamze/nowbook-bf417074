import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { ReviewsTab } from "@/components/dashboard/ReviewsTab";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";

// Standalone provider Reviews page. Reuses ReviewsTab verbatim (the rating
// summary, distribution, and list — all computed from rows via
// useProviderReviews), so no fetch logic is duplicated here.
export default function Reviews() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading } = useProviderProfile();

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  if (!user || !isProvider) return null;

  // No profile yet — mirror the other provider pages' graceful guard.
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/profile")} className="active:scale-95" aria-label={t("profile")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("myReviews")}</h1>
        </div>
      </header>

      <div className="px-5">
        <ReviewsTab />
      </div>
    </div>
  );
}
