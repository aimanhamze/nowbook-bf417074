import { useState, useEffect } from "react";
import { useLang } from "@/contexts/LangContext";
import { ChevronLeft, Download, Share, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const { isRtl } = useLang();
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsInstalled(isStandalone);

    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstalled(true);
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
            <Download className="h-8 w-8 text-accent" />
          </div>
          <h1 className="text-xl font-bold mb-2">האפליקציה מותקנת! ✅</h1>
          <p className="text-muted-foreground text-sm">אתה כבר משתמש באפליקציה.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-secondary transition-colors active:scale-95">
          <ChevronLeft className={`h-5 w-5 ${isRtl ? "rotate-180" : ""}`} />
        </button>
        <h1 className="text-xl font-bold">התקן את האפליקציה</h1>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-5 pt-8 max-w-sm mx-auto w-full"
      >
        <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto mb-6 shadow-lg">
          <img src="/pwa-icon-512.png" alt="Book app icon" className="w-full h-full object-cover" />
        </div>

        {deferredPrompt ? (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">התקן את Book על הטלפון</h2>
            <p className="text-sm text-muted-foreground">גישה מהירה מהמסך הראשי, בדיוק כמו אפליקציה רגילה.</p>
            <button
              onClick={handleInstall}
              className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              התקן עכשיו
            </button>
          </div>
        ) : isIOS ? (
          <div className="space-y-6 text-center">
            <h2 className="text-lg font-semibold">התקנה באייפון</h2>
            <div className="space-y-4 text-sm text-right">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Share className="h-3.5 w-3.5 text-accent" />
                </div>
                <div>
                  <p className="font-medium">1. לחץ על כפתור השיתוף</p>
                  <p className="text-muted-foreground text-xs mt-0.5">בתחתית הדפדפן (Safari)</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Plus className="h-3.5 w-3.5 text-accent" />
                </div>
                <div>
                  <p className="font-medium">2. בחר "הוסף למסך הבית"</p>
                  <p className="text-muted-foreground text-xs mt-0.5">גלול למטה בתפריט השיתוף</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Download className="h-3.5 w-3.5 text-accent" />
                </div>
                <div>
                  <p className="font-medium">3. לחץ "הוסף"</p>
                  <p className="text-muted-foreground text-xs mt-0.5">האפליקציה תופיע במסך הבית</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">התקן את Book</h2>
            <p className="text-sm text-muted-foreground">
              פתח את האתר בדפדפן Chrome ולחץ על תפריט ← "התקן אפליקציה" או "הוסף למסך הבית".
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Install;
