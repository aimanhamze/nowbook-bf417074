import { User, Settings, LogIn, Bell, HelpCircle, ChevronLeft, Globe } from "lucide-react";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";

const Profile = () => {
  const { lang, setLang, t } = useLang();

  const menuItems = [
    { icon: LogIn, label: t("signInUp") },
    { icon: Bell, label: t("notifications") },
    { icon: Settings, label: t("settings") },
    { icon: HelpCircle, label: t("helpSupport") },
  ];

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold">{t("profile")}</h1>
      </header>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="px-5 mb-8 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
          <User className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold">{t("guest")}</p>
          <p className="text-xs text-muted-foreground">{t("signInToManage")}</p>
        </div>
      </motion.div>

      {/* Language Switcher */}
      <div className="px-5 mb-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("language")}</span>
          </div>
          <div className="flex gap-2">
            {([["he", "עברית"], ["ar", "العربية"], ["en", "English"]] as const).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${lang === code ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {menuItems.map(({ icon: Icon, label }, i) => (
            <motion.button key={label} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06, duration: 0.3 }} className="flex items-center justify-between w-full px-4 py-3.5 text-sm hover:bg-secondary/50 transition-colors active:scale-[0.99] border-b border-border last:border-0">
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {label}
              </span>
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Profile;
