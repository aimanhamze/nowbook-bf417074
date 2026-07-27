import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { useProviderClassSchedule, ClassScheduleEntry, ClassScheduleInsert } from "@/hooks/useProviderClassSchedule";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, Users, Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { ServiceColorPicker } from "@/components/dashboard/ServiceColorPicker";
import { DEFAULT_SERVICE_COLOR, normalizeColor } from "@/lib/serviceColors";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DURATION_OPTIONS = [30, 45, 60, 90] as const;

const DEFAULT_FORM: ClassScheduleInsert = {
  day_of_week: 0,
  start_time: "09:00",
  duration_minutes: 60,
  class_name: "",
  class_type: "group",
  max_capacity: 10,
  color: DEFAULT_SERVICE_COLOR,
};

interface ClassFormProps {
  initial: ClassScheduleInsert & { id?: string };
  onSave: (data: ClassScheduleInsert & { id?: string }) => void;
  onCancel: () => void;
  isSaving: boolean;
  participantCount?: number;
  showColorPicker: boolean;
}

function ClassForm({ initial, onSave, onCancel, isSaving, participantCount = 0, showColorPicker }: ClassFormProps) {
  const { t } = useLang();
  const [form, setForm] = useState<ClassScheduleInsert & { id?: string }>(initial);
  const isEdit = !!form.id;

  const set = <K extends keyof ClassScheduleInsert>(key: K, val: ClassScheduleInsert[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = () => {
    if (!form.class_name.trim()) {
      toast.error(t("className") + " " + t("walkInNameRequired"));
      return;
    }
    onSave(form);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="glass-card rounded-2xl p-4 space-y-3 border border-accent/20"
    >
      {isEdit && participantCount > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("editWarningParticipants").replace("{count}", String(participantCount))}</span>
        </div>
      )}

      {/* Class name */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">{t("className")}</label>
        <input
          type="text"
          value={form.class_name}
          onChange={(e) => set("class_name", e.target.value)}
          placeholder={t("className")}
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* Day of week */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">{t("sunday").split("").slice(0).join("") && "יום"}</label>
        <div className="grid grid-cols-4 gap-1.5">
          {DAY_KEYS.map((key, idx) => (
            <button
              key={key}
              type="button"
              onClick={() => set("day_of_week", idx)}
              className={cn(
                "py-1.5 rounded-lg text-xs font-medium transition-all",
                form.day_of_week === idx
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              )}
            >
              {t(key).slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Start time + duration */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("startTime")}</label>
          <input
            type="time"
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("durationLabel")}</label>
          <select
            value={form.duration_minutes}
            onChange={(e) => set("duration_minutes", Number(e.target.value) as typeof DURATION_OPTIONS[number])}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t(("dur" + d) as "dur30" | "dur45" | "dur60" | "dur90")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Class type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">{t("classType")}</label>
        <div className="flex gap-2">
          {(["group", "private"] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => {
                set("class_type", ct);
                if (ct === "private") set("max_capacity", 1);
              }}
              className={cn(
                "flex-1 py-2 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-1.5",
                form.class_type === ct
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              )}
            >
              {ct === "group" ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {ct === "group" ? t("groupClass") : t("privateService")}
            </button>
          ))}
        </div>
      </div>

      {/* Max capacity (editable only for group) */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">{t("maxCapacity")}</label>
        <input
          type="number"
          min={1}
          max={100}
          value={form.max_capacity}
          disabled={form.class_type === "private"}
          onChange={(e) => set("max_capacity", Math.max(1, Math.min(100, Number(e.target.value))))}
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {form.class_type === "private" && (
          <p className="text-[11px] text-muted-foreground mt-1">{t("privateService")} — {t("maxCapacity")}: 1</p>
        )}
      </div>

      {/* Calendar color — gated on the provider's master colors switch */}
      {showColorPicker && (
        <ServiceColorPicker value={form.color} onChange={(color) => set("color", color)} />
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSaving}
          className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          {isSaving ? "..." : t("save")}
        </button>
      </div>
    </motion.div>
  );
}

interface ClassCardProps {
  entry: ClassScheduleEntry;
  onEdit: () => void;
  onDelete: () => void;
  showColor: boolean;
}

function ClassCard({ entry, onEdit, onDelete, showColor }: ClassCardProps) {
  const { t } = useLang();
  const isGroup = entry.class_type === "group";

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/70 border border-white/60 shadow-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {showColor && (
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: normalizeColor(entry.color) }}
              aria-hidden
            />
          )}
          <p className="text-sm font-semibold truncate">{entry.class_name}</p>
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0",
            isGroup ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground"
          )}>
            {isGroup ? <Users className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
            {isGroup ? t("groupClass") : t("privateService")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.start_time.slice(0, 5)} · {entry.duration_minutes} {t("min")}
          {isGroup && ` · ${t("maxCapacity")}: ${entry.max_capacity}`}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </button>
      </div>
    </div>
  );
}

export function WeeklyScheduleTab() {
  const { t } = useLang();
  const { schedule, isLoading, addClass, updateClass, deleteClass } = useProviderClassSchedule();
  const { profile } = useProviderProfile();
  const serviceColorsEnabled = profile?.service_colors_enabled ?? false;
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<(ClassScheduleEntry & { participantCount?: number }) | null>(null);

  const groupedByDay = DAY_KEYS.reduce(
    (acc, _, idx) => {
      acc[idx] = schedule.filter((s) => s.day_of_week === idx);
      return acc;
    },
    {} as Record<number, ClassScheduleEntry[]>
  );

  const handleAdd = async (data: ClassScheduleInsert & { id?: string }) => {
    if (data.id) {
      await updateClass.mutateAsync({ id: data.id, ...data });
      // Notify participants if any
      if ((editingEntry?.participantCount ?? 0) > 0) {
        // Fetch bookings for this schedule entry (future dates)
        const today = new Date().toISOString().slice(0, 10);
        const { data: bookings } = await supabase
          .from("bookings")
          .select("user_id")
          .eq("class_schedule_id", data.id)
          .gte("booking_date", today)
          .in("status", ["confirmed", "pending"]);
        const userIds = [...new Set((bookings || []).map((b) => b.user_id).filter(Boolean))] as string[];
        if (userIds.length > 0) {
          await supabase.from("notifications").insert(
            userIds.map((uid) => ({
              user_id: uid,
              title: data.class_name,
              body: t("classUpdatedNotification"),
              url: "/bookings",
              type: "class_updated",
            }))
          );
        }
      }
      toast.success(t("classUpdatedSuccess"));
    } else {
      await addClass.mutateAsync(data);
      toast.success(t("classAddedSuccess"));
    }
    setShowForm(false);
    setEditingEntry(null);
  };

  const handleEditClick = async (entry: ClassScheduleEntry) => {
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("class_schedule_id", entry.id)
      .gte("booking_date", today)
      .in("status", ["confirmed", "pending"]);
    setEditingEntry({ ...entry, participantCount: count ?? 0 });
    setShowForm(false);
  };

  const handleDelete = async (entry: ClassScheduleEntry) => {
    await deleteClass.mutateAsync(entry.id);
    toast.success(t("classDeletedSuccess"));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add button */}
      <AnimatePresence mode="wait">
        {!showForm && !editingEntry && (
          <motion.button
            key="add-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowForm(true)}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-accent/30 text-accent text-sm font-semibold hover:bg-accent/5 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t("addClass")}
          </motion.button>
        )}

        {showForm && (
          <ClassForm
            key="new-form"
            initial={DEFAULT_FORM}
            onSave={handleAdd}
            onCancel={() => setShowForm(false)}
            isSaving={addClass.isPending}
            showColorPicker={serviceColorsEnabled}
          />
        )}

        {editingEntry && (
          <ClassForm
            key={`edit-${editingEntry.id}`}
            initial={{
              id: editingEntry.id,
              day_of_week: editingEntry.day_of_week,
              start_time: editingEntry.start_time.slice(0, 5),
              duration_minutes: editingEntry.duration_minutes,
              class_name: editingEntry.class_name,
              class_type: editingEntry.class_type,
              max_capacity: editingEntry.max_capacity,
              color: normalizeColor(editingEntry.color),
            }}
            onSave={handleAdd}
            onCancel={() => setEditingEntry(null)}
            isSaving={updateClass.isPending}
            participantCount={editingEntry.participantCount}
            showColorPicker={serviceColorsEnabled}
          />
        )}
      </AnimatePresence>

      {/* Empty state */}
      {schedule.length === 0 && !showForm && (
        <div className="glass-card-md rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold mb-1">{t("classScheduleEmpty")}</p>
          <p className="text-xs text-muted-foreground">{t("classScheduleEmptyHelp")}</p>
        </div>
      )}

      {/* Weekly grid */}
      {DAY_KEYS.map((dayKey, idx) => {
        const dayClasses = groupedByDay[idx] || [];
        if (dayClasses.length === 0) return null;
        return (
          <div key={dayKey} className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
              {t(dayKey)}
            </p>
            {dayClasses.map((entry) => (
              <ClassCard
                key={entry.id}
                entry={entry}
                onEdit={() => handleEditClick(entry)}
                onDelete={() => handleDelete(entry)}
                showColor={serviceColorsEnabled}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
