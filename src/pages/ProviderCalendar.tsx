import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarTab } from "@/components/dashboard/CalendarTab";
import { BackArrow } from "@/components/ui/directional-icon";

export default function ProviderCalendar() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  if (!user || !isProvider) return null;

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="active:scale-95">
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("bookingsCalendar")}</h1>
        </div>
      </header>
      <div className="px-5">
        <CalendarTab />
      </div>
    </div>
  );
}
