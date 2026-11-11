import { useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import { useProviderServices } from "@/hooks/useProviderServices";
import { toast } from "sonner";
import { EditSheet, SettingsGroup, SwitchRow } from "./SettingsRows";

/** Only PRIVATE services are parallel-eligible. Group/capacity services have
 *  their own exact-start capacity model where "parallel" is meaningless. */
function parallelEligible<T extends { service_type?: string | null }>(services: T[]): T[] {
  return services.filter((s) => s.service_type !== "group");
}

/**
 * Editor for the per-service `is_parallel` flag, opened from the services
 * section's "Parallel services" row.
 *
 * Same save path as before: each switch saves immediately through
 * updateServiceParallel (one column, never the whole row), group services are
 * excluded, and the shared services cache refreshes the row's count live.
 * Immediate-save toggles, so no branch suffix and no Save button — just Done.
 */
export function ParallelServicesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLang();
  const { services, updateServiceParallel } = useProviderServices();
  const [savingId, setSavingId] = useState<string | null>(null);
  const eligible = parallelEligible(services);

  const toggle = async (id: string, next: boolean) => {
    // Ignore taps while this row's save is in flight (a pale switch reads as
    // unavailable, so it is not greyed out).
    if (savingId === id) return;
    setSavingId(id);
    try {
      await updateServiceParallel.mutateAsync({ id, is_parallel: next });
      toast.success(t("bsSaved"));
    } catch {
      toast.error(t("bsSaveError"));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <EditSheet
      open={open}
      onClose={() => onOpenChange(false)}
      icon={Layers}
      title={t("parallelServicesTitle")}
      description={t("parallelServicesSubtitle")}
      writes={false}
      footer={
        <Button onClick={() => onOpenChange(false)} className="h-12 w-full rounded-2xl text-base font-semibold">
          {t("parallelDone")}
        </Button>
      }
    >
      <p className="rounded-2xl bg-accent/[0.07] p-4 text-sm leading-relaxed text-foreground/75">
        {t("parallelServicesHelp")}
      </p>
      {eligible.length < 2 ? (
        <p className="rounded-2xl border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/60">
          {t("parallelServicesMinNote")}
        </p>
      ) : (
        <SettingsGroup plain>
          {eligible.map((s) => (
            <SwitchRow
              key={s.id}
              title={s.name}
              checked={!!s.is_parallel}
              onChange={(next) => void toggle(s.id, next)}
            />
          ))}
        </SettingsGroup>
      )}
    </EditSheet>
  );
}
