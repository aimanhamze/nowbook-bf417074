import { useState } from "react";
import { BarChart3, Store, Users } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { useNavigate } from "react-router-dom";
import { AdminStats } from "@/components/admin/AdminStats";
import { AdminProviders } from "@/components/admin/AdminProviders";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";

type TabId = "stats" | "providers" | "users";

const Admin = () => {
  const [activeTab, setActiveTab] = useState<TabId>("stats");
  const navigate = useNavigate();
  const { t } = useLang();

  const tabs: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
    { id: "stats", label: t("adminStats"), icon: BarChart3 },
    { id: "providers", label: t("adminProviders"), icon: Store },
    { id: "users", label: t("adminUsers"), icon: Users },
  ];

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-secondary active:scale-95">
            <BackArrow variant="arrow" className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">{t("adminDashboard")}</h1>
        </div>

        <div className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <section className="px-5 mt-4">
        {activeTab === "stats" && <AdminStats />}
        {activeTab === "providers" && <AdminProviders />}
        {activeTab === "users" && <AdminUsers />}
      </section>
    </div>
  );
};

export default Admin;
