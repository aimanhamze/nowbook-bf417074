import { useState } from "react";
import { format } from "date-fns";
import { CalendarOff, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/contexts/LangContext";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { toast } from "sonner";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function AvailabilityTab() {
  const { t } = useLang();
  const { availability, blockedDates, upsertAvailability, blockDate, unblockDate } = useProviderAvailability();
  const [blockingDate, setBlockingDate] = useState<Date | undefined>();
  const [blockReason, setBlockReason] = useState("");

  const getSlot = (dow: number) => availability.find(a => a.day_of_week === dow);

  const handleToggle = async (dow: number, checked: boolean) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: existing?.start_time || "09:00",
        end_time: existing?.end_time || "17:00",
        is_available: checked,
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleTimeChange = async (dow: number, field: "start_time" | "end_time", value: string) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: field === "start_time" ? value : (existing?.start_time || "09:00"),
        end_time: field === "end_time" ? value : (existing?.end_time || "17:00"),
        is_available: existing?.is_available ?? true,
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleBlockDate = async () => {
    if (!blockingDate) return;
    try {
      await blockDate.mutateAsync({ blocked_date: format(blockingDate, "yyyy-MM-dd"), reason: blockReason });
      toast.success(t("dateBlocked"));
      setBlockingDate(undefined);
      setBlockReason("");
    } catch (err: any) {
      toast.error(err?.message || "Error blocking date");
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">{t("availability")}</h2>

      {/* Weekly schedule */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">{t("workingHoursLabel")}</h3>
        {DAY_KEYS.map((dayKey, dow) => {
          const slot = getSlot(dow);
          // Reads the real row (every provider has all 7 post-backfill). If a
          // row were ever missing, honest behavior is closed — not a default.
          const isAvail = slot?.is_available ?? false;
          return (
            <motion.div
              key={dayKey}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: dow * 0.04 }}
              className="flex items-center gap-3"
            >
              <Switch checked={isAvail} onCheckedChange={c => handleToggle(dow, c)} />
              <span className="text-sm font-medium w-16">{t(dayKey)}</span>
              {isAvail ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <Input
                    key={`${dow}-start-${slot?.start_time ?? "09:00"}`}
                    type="time"
                    className="h-8 text-xs flex-1"
                    defaultValue={slot?.start_time?.slice(0, 5) || "09:00"}
                    onBlur={e => handleTimeChange(dow, "start_time", e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    key={`${dow}-end-${slot?.end_time ?? "17:00"}`}
                    type="time"
                    className="h-8 text-xs flex-1"
                    defaultValue={slot?.end_time?.slice(0, 5) || "17:00"}
                    onBlur={e => handleTimeChange(dow, "end_time", e.target.value)}
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{t("unavailable")}</span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Blocked dates */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">{t("blockedDates")}</h3>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <CalendarOff className="h-3.5 w-3.5" />
              {t("blockDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={blockingDate}
              onSelect={setBlockingDate}
              className="pointer-events-auto"
              disabled={(date) => date < new Date()}
            />
            {blockingDate && (
              <div className="p-3 border-t space-y-2">
                <Input
                  placeholder={t("reason")}
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button size="sm" className="w-full" onClick={handleBlockDate}>{t("save")}</Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {blockedDates.length > 0 && (
          <div className="space-y-1.5">
            {blockedDates.map(bd => (
              <div key={bd.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{format(new Date(bd.blocked_date), "MMM d, yyyy")}</span>
                  {bd.reason && <span className="text-muted-foreground ms-2">– {bd.reason}</span>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={async () => {
                    await unblockDate.mutateAsync(bd.id);
                    toast.success(t("dateUnblocked"));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
