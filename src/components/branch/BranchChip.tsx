import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, MapPin, Store } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useBranchPendingCounts } from "@/hooks/useBranchPendingCounts";
import { setActiveBranchId } from "@/lib/activeBranch";
import { cn } from "@/lib/utils";

// Unicode isolates: keep a Latin branch name from reordering the surrounding
// Hebrew/Arabic sentence in plain-text contexts (toasts) where <bdi> can't go.
const isolate = (s: string) => `⁨${s}⁩`;

// Multi-branch: which branch this screen is working on — avatar, name, chevron
// — shown under the title of every provider screen. Tapping it opens the
// branch sheet. Only rendered for owners with 2+ branches (ProviderPageTitle,
// Dashboard and Settings decide); a single-branch owner never mounts it.
//
// Switching writes the active id and stays on the current screen: BranchScope
// (App.tsx) and the Dashboard's tab key remount the screen on the new branch,
// which closes open sheets and drops state that belonged to the old branch.
// The one exception is a staff member page — that member belongs to the old
// branch, so it goes back to the staff list.
export function BranchChip() {
  const { t, isRtl } = useLang();
  const { user } = useAuth();
  const { profile, branches } = useProviderProfile();
  const { countFor, otherBranchesPending } = useBranchPendingCounts();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  if (!user || !profile) return null;

  const choose = (branchId: string) => {
    setOpen(false);
    if (branchId === profile.id) return;
    const target = branches.find((b) => b.id === branchId);
    if (/^\/staff\/[^/]+/.test(pathname)) navigate("/staff", { replace: true });
    setActiveBranchId(user.id, branchId);
    if (target) toast(t("switchedToBranch").replace("{name}", isolate(target.business_name)));
  };

  return (
    <>
      {/* Compact under the title; ::after extends the hit area to 44px tall
          without pushing the header layout around. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t("switchBranch")}: ${profile.business_name}${
          otherBranchesPending ? ` — ${t("otherBranchPending")}` : ""
        }`}
        className="relative mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary/80 py-0.5 pe-2 ps-0.5 text-xs font-medium text-foreground transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-secondary active:scale-[0.98]"
      >
        <BranchAvatar src={profile.avatar_image} size="sm" />
        <bdi className="truncate">{profile.business_name}</bdi>
        <span className="relative shrink-0">
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          {/* Another branch (never the active one — the bottom-nav badge
              covers that) has bookings waiting for approval. */}
          {otherBranchesPending && (
            <span
              data-testid="other-branch-pending-dot"
              className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
            />
          )}
        </span>
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
              const pending = countFor(b.id);
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
                    <BranchAvatar src={b.avatar_image} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        <bdi>{b.business_name}</bdi>
                      </p>
                      {b.address && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <bdi className="truncate">{b.address}</bdi>
                        </p>
                      )}
                    </div>
                    {pending > 0 && (
                      // Same look as the bottom-nav badge: red number = pending.
                      <span
                        aria-label={`${pending} ${t("pendingTab")}`}
                        className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground"
                      >
                        {pending > 9 ? "9+" : pending}
                      </span>
                    )}
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

function BranchAvatar({ src, size }: { src: string | null; size: "sm" | "lg" }) {
  const box = size === "sm" ? "h-5 w-5 rounded-full" : "h-10 w-10 rounded-xl";
  const icon = size === "sm" ? "h-3 w-3" : "h-5 w-5";
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center overflow-hidden bg-accent/10`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <Store className={`${icon} text-accent`} />
      )}
    </span>
  );
}
