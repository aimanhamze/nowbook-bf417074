import { useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import { FacetSheet } from "./FacetSheet";

interface Props {
  open: boolean;
  onClose: () => void;
  memberName: string;
  /** Active, non-group services — the only ones an assignment can affect. */
  services: { id: string; name: string }[];
  /** The member's current restriction set. Empty = performs everything. */
  initialIds: string[];
  onSave: (ids: string[]) => Promise<void>;
  saving: boolean;
}

/**
 * Which services this member performs.
 *
 * A SEGMENTED CONTROL replaces the old hint paragraph: "all services" versus
 * "selected". A list of switches all set to off never read as "performs
 * everything", so the empty set — which IS meaningful, and is stored as zero
 * rows — gets its own explicit position. Choosing "all" saves an empty set;
 * choosing "selected" with nothing ticked is allowed and surfaces on the card
 * as a warning, because that is a real misconfiguration worth seeing.
 */
export function ServicesSheet({ open, onClose, memberName, services, initialIds, onSave, saving }: Props) {
  const { t } = useLang();
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [ids, setIds] = useState<string[]>([]);

  // Re-derive the draft from ROWS every time the sheet opens, never from what
  // the last edit left behind — Cancel must be a genuine no-op.
  useEffect(() => {
    if (open) {
      setIds(initialIds);
      setMode(initialIds.length > 0 ? "selected" : "all");
    }
  }, [open, initialIds]);

  const toggle = (id: string, next: boolean) =>
    setIds((prev) => (next ? [...prev, id] : prev.filter((x) => x !== id)));

  return (
    <FacetSheet
      open={open}
      onClose={onClose}
      icon={Scissors}
      title={t("staffFacetServices")}
      subtitle={memberName}
      saving={saving}
      onSave={() => onSave(mode === "all" ? [] : ids)}
    >
      <div className="flex gap-1 rounded-[14px] bg-secondary p-1" role="tablist">
        <SegButton active={mode === "all"} onClick={() => setMode("all")}>{t("staffServicesAll")}</SegButton>
        <SegButton active={mode === "selected"} onClick={() => setMode("selected")}>{t("staffSvcModeSelected")}</SegButton>
      </div>

      {mode === "all" ? (
        <p className="px-1 text-[13px] leading-relaxed text-muted-foreground">{t("staffSvcAllHint")}</p>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => {
            const checked = ids.includes(svc.id);
            return (
              <label
                key={svc.id}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                  checked ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-card",
                )}
              >
                <span className="min-w-0 flex-1 text-sm font-medium">{svc.name}</span>
                <Switch checked={checked} onCheckedChange={(next) => toggle(svc.id, next)} />
              </label>
            );
          })}
        </div>
      )}
    </FacetSheet>
  );
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-10 flex-1 items-center justify-center rounded-[10px] px-2.5 py-1.5 text-center text-[13px] font-semibold transition-all",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
