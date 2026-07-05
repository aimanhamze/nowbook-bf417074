import { useState } from "react";
import { Layers } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderServices } from "@/hooks/useProviderServices";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Entry point + editor for the per-service `is_parallel` flag, moved out of
 * Booking Settings. A counter button (live count of parallel-enabled services)
 * opens a bottom sheet with the explanation + a checklist of switch rows.
 *
 * PURE UI relocation: the save path (updateServiceParallel), the immediate-save
 * + toast + per-row disable, and the group-services-excluded rule are identical
 * to the previous BookingSettingsTab card. Reads the same useProviderServices
 * cache, so toggling a row invalidates it and the count refreshes live.
 */
export function ParallelServicesSheet() {
  const { t } = useLang();
  const { services, updateServiceParallel } = useProviderServices();
  const [savingId, setSavingId] = useState<string | null>(null);

  // Only PRIVATE services are parallel-eligible. Group/capacity services have
  // their own exact-start capacity model where "parallel" is meaningless.
  const parallelEligible = services.filter((s) => s.service_type !== "group");
  const count = parallelEligible.filter((s) => s.is_parallel).length;

  const toggle = async (id: string, next: boolean) => {
    setSavingId(id);
    try {
      await updateServiceParallel.mutateAsync({ id, is_parallel: next });
      toast.success(t("profileSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-start shadow-[0_4px_16px_-12px_rgba(120,70,30,0.25)] transition-all active:scale-[0.99] hover:border-accent/40"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Layers className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("parallelServicesTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              {count > 0 ? `${count} ${t("parallelServicesActive")}` : t("parallelServicesNone")}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums",
              count > 0 ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
            )}
          >
            {count}
          </span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className={`flex max-h-[88vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
      >
        {/* Grab handle */}
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />

        {/* Header */}
        <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle>{t("parallelServicesTitle")}</SheetTitle>
              <SheetDescription className="text-start">{t("parallelServicesSubtitle")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          {/* Explanation + concrete example */}
          <div className="rounded-2xl border border-accent/15 bg-accent/[0.06] p-4 text-sm leading-relaxed text-foreground/70">
            {t("parallelServicesHelp")}
          </div>

          {parallelEligible.length < 2 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t("parallelServicesMinNote")}
            </div>
          ) : (
            <div className="space-y-2">
              {parallelEligible.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                    s.is_parallel ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-card"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                  <Switch
                    checked={!!s.is_parallel}
                    onCheckedChange={(next) => toggle(s.id, next)}
                    disabled={savingId === s.id}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
          <SheetClose asChild>
            <Button className="h-12 w-full text-base font-semibold">{t("parallelDone")}</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
