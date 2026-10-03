import { useState } from "react";
import { Check, ChevronDown, MapPin, Store } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { setActiveBranchId } from "@/lib/activeBranch";
import { cn } from "@/lib/utils";

// Multi-branch: lets an owner with several branches choose which one the
// dashboard works on. It takes the place of the business-name line under the
// Dashboard title — that line already answers "which business am I in?", so the
// switcher is that same answer, made tappable.
//
// The Dashboard only renders this when the owner has 2+ branches; a
// single-branch owner (every owner today) keeps the plain business-name line.
//
// Switching only writes the active id. The Dashboard keys its tab content on
// that id, so the switch remounts the tab: open sheets close and every form
// reloads from the new branch instead of carrying the old branch's values.
export function BranchSwitcher() {
  const { t, isRtl } = useLang();
  const { user } = useAuth();
  const { profile, branches } = useProviderProfile();
  const [open, setOpen] = useState(false);

  if (!user || !profile) return null;

  const choose = (branchId: string) => {
    setOpen(false);
    if (branchId !== profile.id) setActiveBranchId(user.id, branchId);
  };

  return (
    <>
      {/* Visually a compact pill under the title; the ::after extends the hit
          area to 44px tall without pushing the header layout around. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t("switchBranch")}: ${profile.business_name}`}
        className="relative mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-secondary active:scale-[0.98]"
      >
        <span className="truncate">{profile.business_name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          dir={isRtl ? "rtl" : "ltr"}
          aria-describedby={undefined}
          className={`rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] ${providerDesktopSheet}`}
        >
          <SheetHeader>
            <SheetTitle>{t("yourBranches")}</SheetTitle>
          </SheetHeader>

          <ul className="mt-4 space-y-2">
            {branches.map((b) => {
              const active = b.id === profile.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => choose(b.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex min-h-[56px] w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors active:scale-[0.99]",
                      active
                        ? "border-accent/40 bg-accent/5"
                        : "border-border/60 bg-card hover:bg-secondary/60",
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent/10">
                      {b.avatar_image ? (
                        <img src={b.avatar_image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Store className="h-5 w-5 text-accent" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.business_name}</p>
                      {b.address && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{b.address}</span>
                        </p>
                      )}
                    </div>
                    {active && (
                      <Check className="h-5 w-5 shrink-0 text-accent" aria-label={t("currentBranch")} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
