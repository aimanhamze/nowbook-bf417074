import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, X, Phone, User, Users } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderCustomers } from "@/hooks/useProviderCustomers";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";

// Standalone provider "My Customers" page. ALL customer PII comes from the
// single isolated hook useProviderCustomers() — this page does no profiles/
// bookings reads of its own, only client-side search + presentation.
export default function ProviderCustomers() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading } = useProviderProfile();
  const { data: customers = [], isLoading } = useProviderCustomers();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))
    );
  }, [customers, query]);

  if (!user || !isProvider) return null;

  // No provider profile yet — mirror the other provider pages' graceful guard.
  if (!profileLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-x-clip pb-24"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Warm radial accent glows — matched to Profile/Home for identity continuity. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[22rem] [inset-inline-start:-6rem] h-[28rem] w-[28rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.4) 0%, transparent 65%)" }}
      />

      <div className="relative">
        <header className="px-5 pt-12 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate("/profile")} className="active:scale-95" aria-label={t("profile")}>
              <BackArrow className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold flex-1">{t("myCustomers")}</h1>
            {customers.length > 0 && (
              <span className="text-xs font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-full">
                {customers.length}
              </span>
            )}
          </div>

          {/* Search — name or phone, RTL, with clear button. */}
          <div className="flex items-center gap-3 glass-card rounded-2xl px-4 py-3 transition-shadow focus-within:ring-1 focus-within:ring-accent/30">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              inputMode="search"
              placeholder={t("searchCustomers")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={t("clear")}
                className="shrink-0 text-muted-foreground/70 hover:text-foreground active:scale-90 transition"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        <div className="px-5">
          {isLoading ? (
            // Skeleton rows
            <div className="glass-card-md rounded-2xl overflow-hidden">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3 border-b border-border/50 last:border-0">
                  <div className="h-10 w-10 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : customers.length === 0 ? (
            // Empty state — no customers yet at all.
            <EmptyState
              icon={<Users className="h-7 w-7 text-accent" />}
              title={t("noCustomersYet")}
              help={t("noCustomersYetHelp")}
            />
          ) : filtered.length === 0 ? (
            // Empty state — search matched nothing.
            <EmptyState
              icon={<Search className="h-7 w-7 text-accent" />}
              title={t("noCustomersFound")}
              help={t("noCustomersFoundHelp")}
            />
          ) : (
            <div className="glass-card-md rounded-2xl overflow-hidden">
              {filtered.map((c, i) => {
                const displayName = c.name?.trim() || t("customerFallback");
                return (
                  <motion.div
                    key={c.key}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.3 }}
                    className="flex items-center gap-3 px-3.5 py-3 border-b border-border/50 last:border-0"
                  >
                    <span className="flex items-center justify-center h-10 w-10 rounded-full bg-accent/10 text-accent shrink-0">
                      <User className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate leading-tight">{displayName}</p>
                      {c.phone ? (
                        // tap-to-call: trivial tel: link, no helper needed.
                        <a
                          href={`tel:${c.phone.replace(/\s/g, "")}`}
                          dir="ltr"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition mt-0.5 [text-align:start]"
                        >
                          <Phone className="h-3 w-3 shrink-0" />
                          {c.phone}
                        </a>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">—</p>
                      )}
                    </div>

                    <span className="shrink-0 text-xs font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-full whitespace-nowrap">
                      {c.bookingCount} {t("bookingsUnit")}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, help }: { icon: React.ReactNode; title: string; help: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card rounded-2xl p-8 flex flex-col items-center text-center gap-3 mt-2"
    >
      <span className="flex items-center justify-center h-14 w-14 rounded-2xl bg-accent/10">{icon}</span>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground max-w-[16rem]">{help}</p>
    </motion.div>
  );
}
