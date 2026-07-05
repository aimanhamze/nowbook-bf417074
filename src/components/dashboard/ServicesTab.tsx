import { useState } from "react";
import { Plus, Pencil, Trash2, Clock, Users, User, CalendarPlus, X, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderSessions } from "@/hooks/useProviderSessions";
import { ParallelServicesSheet } from "@/components/dashboard/ParallelServicesSheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";
import { format } from "date-fns";

const serviceSchema = z.object({
  name: z.string().min(1, "שם השירות נדרש").max(100),
  duration: z.number().min(5, "משך מינימלי 5 דקות").max(480, "משך מקסימלי 8 שעות"),
  price: z.number().min(0, "מחיר לא יכול להיות שלילי").max(99999),
  max_capacity: z.number().min(2, "קבוצה דורשת לפחות 2 מקומות").max(100),
});

// Hidden per product decision (we may rework per-slot capacity later). Flip to
// `true` to restore the private-service "max customers per slot" input + helper
// note in the add/edit form. While false, private services always save
// max_capacity = 1. Group/class capacity is unaffected.
const SHOW_PRIVATE_CAPACITY = false;

type EditState = {
  id?: string;
  name: string;
  duration: number;
  price: number;
  service_type: 'private' | 'group';
  max_capacity: number;
  latest_start_time: string;
};

type AddSessionState = {
  service_id: string;
  service_name: string;
  date: string;
  time: string;
};

export function ServicesTab() {
  const { t } = useLang();
  const { profile } = useProviderProfile();
  const isFitness = profile?.category === 'fitness_studio';
  const { services, isLoading, upsertService, deleteService } = useProviderServices();
  const { sessions, addSession, deleteSession } = useProviderSessions();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [addingSession, setAddingSession] = useState<AddSessionState | null>(null);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editing) return;
    const result = serviceSchema.omit({ max_capacity: editing.service_type === 'private' }).safeParse({
      name: editing.name.trim(),
      duration: editing.duration,
      price: editing.price,
      ...(editing.service_type === 'group' ? { max_capacity: editing.max_capacity } : {}),
    });

    if (!result.success) {
      toast.error(result.error.errors[0].message);
      return;
    }

    // Private services may carry a per-slot capacity (>= 1) — "how many
    // customers can book the same time" for an ordinary service. Group keeps
    // its >= 2 rule validated by serviceSchema above. No group framing here.
    if (
      editing.service_type === 'private' &&
      (!Number.isInteger(editing.max_capacity) || editing.max_capacity < 1 || editing.max_capacity > 100)
    ) {
      toast.error(t("capacityInvalid"));
      return;
    }

    try {
      await upsertService.mutateAsync({
        ...editing,
        name: editing.name.trim(),
        // Capacity input is hidden for PRIVATE services (SHOW_PRIVATE_CAPACITY),
        // so hard-default them to 1 rather than trusting the now-unedited field.
        // Group/class services keep their configured capacity.
        max_capacity: editing.service_type === 'group' ? editing.max_capacity : 1,
        latest_start_time: editing.latest_start_time || null,
      });
      toast.success(t("serviceSaved"));
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("reviewError"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteService.mutateAsync(id);
      toast.success(t("serviceDeleted"));
    } catch (err) {
      if (err instanceof Error && err.message === "HAS_FUTURE_BOOKINGS") {
        toast.error(t("serviceHasBookings"));
      } else {
        toast.error("Error deleting service");
      }
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleAddSession = async () => {
    if (!addingSession) return;
    if (!addingSession.date || !addingSession.time) {
      toast.error("בחר תאריך ושעה");
      return;
    }
    try {
      await addSession.mutateAsync({
        service_id: addingSession.service_id,
        session_date: addingSession.date,
        session_time: addingSession.time,
      });
      toast.success("המפגש נוסף בהצלחה");
      setAddingSession(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בהוספת מפגש");
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession.mutateAsync(id);
      toast.success("המפגש נמחק");
    } catch {
      toast.error("שגיאה במחיקת מפגש");
    }
  };

  const openNew = () => setEditing({ name: "", duration: 60, price: 0, service_type: 'private', max_capacity: 1, latest_start_time: "" });

  const openEdit = (svc: typeof services[number]) => setEditing({
    id: svc.id,
    name: svc.name,
    duration: svc.duration,
    price: svc.price,
    service_type: (svc.service_type as 'private' | 'group') || 'private',
    max_capacity: svc.max_capacity ?? 1,
    latest_start_time: (svc as { latest_start_time?: string | null }).latest_start_time?.slice(0, 5) ?? "",
  });

  const openAddSession = (svc: typeof services[number]) => {
    const today = format(new Date(), "yyyy-MM-dd");
    setAddingSession({
      service_id: svc.id,
      service_name: svc.name,
      date: today,
      time: "09:00",
    });
  };

  const todayStr = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("manageServices")}</h2>
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("addService")}
        </Button>
      </div>

      {/* Parallel-services entry point — counter button opens the config sheet */}
      <ParallelServicesSheet />

      {/* Add/Edit service — bottom sheet (matches ParallelServicesSheet).
          Controlled by `editing`: openNew()/openEdit() open it; closing or
          cancel clears `editing`. Same form, fields, validation, hidden-capacity
          behavior and upsertService mutation — only the container changed. */}
      <Sheet open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <SheetContent
          side="bottom"
          className={`flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
        >
          {/* Grab handle */}
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />

          {/* Header */}
          <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                {editing?.id ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </span>
              <SheetTitle>{editing?.id ? t("editServiceTitle") : t("addService")}</SheetTitle>
            </div>
          </SheetHeader>

          {/* Body — only mounted while editing, so `editing` is non-null inside */}
          {editing && (
            <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-5 pt-4">
              <div>
                <Label>{t("serviceName")}</Label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>

              {isFitness && (
                <div>
                  <Label className="mb-1.5 block">{t("serviceType")}</Label>
                  <div className="flex rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEditing({ ...editing, service_type: 'private', max_capacity: 1 })}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                        editing.service_type === 'private'
                          ? "bg-accent text-accent-foreground"
                          : "bg-card text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      <User className="h-3.5 w-3.5" />
                      {t("privateService")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ ...editing, service_type: 'group', max_capacity: Math.max(2, editing.max_capacity) })}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                        editing.service_type === 'group'
                          ? "bg-accent text-accent-foreground"
                          : "bg-card text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {t("groupClass")}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("duration")} ({t("min")})</Label>
                  <Input type="number" value={editing.duration} onChange={e => setEditing({ ...editing, duration: Number(e.target.value) })} onFocus={e => e.target.select()} />
                </div>
                <div>
                  <Label>{t("price")} (₪)</Label>
                  <Input type="number" value={editing.price} onChange={e => setEditing({ ...editing, price: Number(e.target.value) })} onFocus={e => e.target.select()} />
                </div>
              </div>

              {isFitness && editing.service_type === 'group' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Label>{t("maxCapacity")}</Label>
                  <Input
                    type="number"
                    min={2}
                    max={100}
                    value={editing.max_capacity}
                    onChange={e => setEditing({ ...editing, max_capacity: Math.max(2, Number(e.target.value)) })}
                    onFocus={e => e.target.select()}
                  />
                </motion.div>
              )}

              {/* Per-slot capacity for ordinary (private) services — available to
                  every provider, NOT gated to fitness and NOT group framing.
                  1 = normal single-customer service.
                  HIDDEN: gated behind SHOW_PRIVATE_CAPACITY (currently false) so
                  providers don't see/edit it; flip the flag to restore. */}
              {SHOW_PRIVATE_CAPACITY && editing.service_type === 'private' && (
                <div>
                  <Label>{t("maxCustomersPerSlot")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={editing.max_capacity}
                    // Don't clamp per-keystroke: Math.max(1, …) snapped the value
                    // back to 1 whenever the field was briefly empty/0 mid-typing
                    // (Number("") = 0 → Math.max(1,0) = 1), making it uneditable.
                    // Store the raw number while editing; clamp to [1,100] on blur.
                    // handleSave also validates the 1-100 range as a backstop.
                    onChange={e => setEditing({ ...editing, max_capacity: Number(e.target.value) })}
                    onBlur={() => setEditing(prev =>
                      prev ? { ...prev, max_capacity: Math.min(100, Math.max(1, prev.max_capacity || 1)) } : prev
                    )}
                    onFocus={e => e.target.select()}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t("maxCustomersPerSlotHelp")}</p>
                </div>
              )}

              <div>
                <Label>{"שעת התחלה אחרונה (אופציונלי)"}</Label>
                <Input
                  type="time"
                  value={editing.latest_start_time}
                  onChange={e => setEditing({ ...editing, latest_start_time: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("latestStartTimeHelper")}</p>
              </div>
            </div>
          )}

          {/* Sticky footer — save / cancel */}
          <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={upsertService.isPending} className="h-12 flex-1 text-base font-semibold">{t("save")}</Button>
              <Button variant="ghost" onClick={() => setEditing(null)} className="h-12">{t("cancel")}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add session form */}
      <AnimatePresence>
        {addingSession && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl border border-accent/30 bg-accent/5 p-4 space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <CalendarPlus className="h-4 w-4 text-accent" />
                הוסף מפגש — {addingSession.service_name}
              </p>
              <button onClick={() => setAddingSession(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>תאריך</Label>
                <Input
                  type="date"
                  min={todayStr}
                  value={addingSession.date}
                  onChange={e => setAddingSession({ ...addingSession, date: e.target.value })}
                />
              </div>
              <div>
                <Label>שעה</Label>
                <Input
                  type="time"
                  value={addingSession.time}
                  onChange={e => setAddingSession({ ...addingSession, time: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddSession} disabled={addSession.isPending}>הוסף מפגש</Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingSession(null)}>{t("cancel")}</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="font-medium">{t("noServices")}</p>
          <p className="text-sm mt-1">{t("addFirstService")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((svc, i) => {
            const isGroup = svc.service_type === 'group';
            const svcSessions = sessions.filter(s => s.service_id === svc.id);
            const isExpanded = expandedService === svc.id;

            return (
              <motion.div
                key={svc.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                {/* Service row */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{svc.name}</p>
                      {isGroup ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                          <Users className="h-2.5 w-2.5" />
                          {t("groupClass")} · {t("maxCapacity")}: {svc.max_capacity}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                          <User className="h-2.5 w-2.5" />
                          {t("privateService")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {svc.duration} {t("min")}{svc.price > 0 ? ` · ₪${svc.price}` : null}
                      {svcSessions.length > 0 && (
                        <span className="ms-1 text-accent font-medium">· {svcSessions.length} מפגשים</span>
                      )}
                      {(svc as { latest_start_time?: string | null }).latest_start_time && (
                        <span className="ms-1 text-orange-600 font-medium">
                          · עד {(svc as { latest_start_time?: string | null }).latest_start_time!.slice(0, 5)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-accent"
                      onClick={() => {
                        setExpandedService(isExpanded ? null : svc.id);
                        openAddSession(svc);
                      }}
                      title="הוסף מפגש"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(svc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setPendingDeleteId(svc.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Sessions list */}
                {svcSessions.length > 0 && (
                  <div className="border-t border-border/50 bg-secondary/30 px-4 py-2 space-y-1">
                    {svcSessions.map(session => {
                      const dateObj = new Date(session.session_date + "T" + session.session_time);
                      const timeDisplay = session.session_time.slice(0, 5); // HH:MM
                      return (
                        <div key={session.id} className="flex items-center justify-between text-xs py-1">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-3 w-3 text-accent" />
                            <span className="font-medium text-foreground">
                              {format(new Date(session.session_date), "dd/MM/yyyy")}
                            </span>
                            <span className="font-semibold text-accent">@ {timeDisplay}</span>
                          </span>
                          <button
                            onClick={() => handleDeleteSession(session.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteServiceConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteServiceConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteService.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteId) handleDelete(pendingDeleteId);
              }}
            >
              {t("deleteService")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
