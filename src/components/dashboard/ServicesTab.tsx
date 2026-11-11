import { useEffect, useRef, useState } from "react";
import {
  CalendarDays, CalendarPlus, ImagePlus, Image as ImageIcon, Layers, Palette, Pencil, Plus, Sparkles,
  Trash2, User, Users, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useLang } from "@/contexts/LangContext";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderSessions } from "@/hooks/useProviderSessions";
import { usePlural } from "@/hooks/usePlural";
import { ParallelServicesSheet } from "@/components/dashboard/ParallelServicesSheet";
import { ServiceColorPicker } from "@/components/dashboard/ServiceColorPicker";
import { SettingsSwitch } from "@/components/dashboard/SettingsSwitch";
import { DEFAULT_SERVICE_COLOR, normalizeColor } from "@/lib/serviceColors";
import type { TranslationKey } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";
import { format } from "date-fns";
import { validateServiceImage } from "@/lib/serviceImage";
import { EditSheet, Field, NavRow, SettingsGroup, SwitchRow } from "./SettingsRows";
import { GROUP_HEADING, LIST } from "./settingsList";

// Same rules and bounds as before; messages are translation keys now.
const serviceSchema = z.object({
  name: z.string().min(1, "svErrName").max(100, "pfErrTooLong"),
  duration: z.number().min(5, "svErrDurationMin").max(480, "svErrDurationMax"),
  price: z.number().min(0, "svErrPrice").max(99999, "svErrPriceMax"),
  max_capacity: z.number().min(2, "svErrGroupMin").max(100, "svErrGroupMax"),
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
  customer_notes_enabled: boolean;
  customer_notes_placeholder: string;
  color: string;
  // Service image. image_url = the stored value the form opened with;
  // imageFile/imagePreview = a newly picked file (preview is an object URL);
  // removeImage = the provider cleared the stored image.
  image_url: string | null;
  imageFile: File | null;
  imagePreview: string | null;
  removeImage: boolean;
};

// Default guidance text shown to the customer when the provider enables notes
// but leaves the placeholder field blank. Mirrors the DB column default, and
// it is a STORED value (also the booking flow's fallback) — not UI copy, so it
// is deliberately not translated.
const DEFAULT_NOTES_PLACEHOLDER = "הוסף הערות לשירות...";

type Service = ReturnType<typeof useProviderServices>["services"][number];
const latestOf = (svc: Service) => (svc as { latest_start_time?: string | null }).latest_start_time ?? null;
const imageOf = (svc: Service) => (svc as { image_url?: string | null }).image_url?.trim() || null;

// Every write targets the active branch: useProviderServices / useProviderSessions
// insert with provider_id = profile.id, and the dashboard remounts this section
// when the branch changes.
export function ServicesTab() {
  const { t } = useLang();
  const pl = usePlural();
  const { profile, updateServiceColorsEnabled } = useProviderProfile();
  const isFitness = profile?.category === 'fitness_studio';
  const serviceColorsEnabled = profile?.service_colors_enabled ?? false;
  const { services, isLoading, upsertService, deleteService } = useProviderServices();
  const { sessions, addSession, deleteSession } = useProviderSessions();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [parallelOpen, setParallelOpen] = useState(false);
  const [newDate, setNewDate] = useState({ date: "", time: "09:00" });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const tr = (key: string) => t(key as TranslationKey);

  // Release each preview object URL once it is replaced or the sheet closes.
  const imagePreview = editing?.imagePreview ?? null;
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file || !editing) return;
    const invalid = validateServiceImage(file);
    if (invalid) {
      toast.error(t(invalid === "IMAGE_TOO_LARGE" ? "imageTooLarge" : "imageInvalidType"));
      return;
    }
    setEditing({ ...editing, imageFile: file, imagePreview: URL.createObjectURL(file), removeImage: false });
  };

  const handleImageRemove = () => {
    if (!editing) return;
    setEditing({ ...editing, imageFile: null, imagePreview: null, removeImage: true });
  };

  const handleSave = async () => {
    if (!editing || upsertService.isPending) return;
    const result = serviceSchema.omit({ max_capacity: editing.service_type === 'private' }).safeParse({
      name: editing.name.trim(),
      duration: editing.duration,
      price: editing.price,
      ...(editing.service_type === 'group' ? { max_capacity: editing.max_capacity } : {}),
    });

    if (!result.success) {
      const message = result.error.errors[0].message;
      // Our rules carry translation keys; zod's own (e.g. NaN from an empty
      // number field) carry English text, which is never shown.
      toast.error(/^(sv|pf)Err/.test(message) ? tr(message) : t("bsSaveError"));
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
      const { imageError } = await upsertService.mutateAsync({
        id: editing.id,
        name: editing.name.trim(),
        duration: editing.duration,
        price: editing.price,
        service_type: editing.service_type,
        color: editing.color,
        // Capacity input is hidden for PRIVATE services (SHOW_PRIVATE_CAPACITY),
        // so hard-default them to 1 rather than trusting the now-unedited field.
        // Group/class services keep their configured capacity.
        max_capacity: editing.service_type === 'group' ? editing.max_capacity : 1,
        latest_start_time: editing.latest_start_time || null,
        customer_notes_enabled: editing.customer_notes_enabled,
        customer_notes_placeholder: editing.customer_notes_placeholder.trim() || DEFAULT_NOTES_PLACEHOLDER,
        imageFile: editing.imageFile,
        removeImage: editing.removeImage,
        current_image_url: editing.image_url,
      });
      // The service itself is saved either way; only the image step can fail
      // separately, and the sheet closes so a retry edits rather than re-inserts.
      if (imageError) toast.error(t("serviceImageFailed"));
      else toast.success(t("serviceSaved"));
      setEditing(null);
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteService.mutateAsync(id);
      toast.success(t("serviceDeleted"));
      // Deleted from inside its sheet: close the sheet too.
      setEditing((e) => (e?.id === id ? null : e));
    } catch (err) {
      if (err instanceof Error && err.message === "HAS_FUTURE_BOOKINGS") {
        toast.error(t("serviceHasBookings"));
      } else {
        toast.error(t("svDeleteError"));
      }
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleColorsToggle = async (next: boolean) => {
    if (updateServiceColorsEnabled.isPending) return;
    try {
      await updateServiceColorsEnabled.mutateAsync(next);
      toast.success(t("bsSaved"));
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  // ── Fixed dates (provider_sessions) — immediate saves, not part of the draft ──
  const handleAddSession = async () => {
    if (!editing?.id || addSession.isPending) return;
    if (!newDate.date || !newDate.time) {
      toast.error(t("svDateNeedBoth"));
      return;
    }
    try {
      await addSession.mutateAsync({
        service_id: editing.id,
        session_date: newDate.date,
        session_time: newDate.time,
      });
      toast.success(t("svDateAdded"));
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (deleteSession.isPending) return;
    try {
      await deleteSession.mutateAsync(id);
      toast.success(t("svDateRemoved"));
    } catch {
      toast.error(t("svDeleteError"));
    }
  };

  const openNew = () => setEditing({ name: "", duration: 60, price: 0, service_type: 'private', max_capacity: 1, latest_start_time: "", customer_notes_enabled: false, customer_notes_placeholder: "", color: DEFAULT_SERVICE_COLOR, image_url: null, imageFile: null, imagePreview: null, removeImage: false });

  const openEdit = (svc: Service) => {
    setNewDate({ date: format(new Date(), "yyyy-MM-dd"), time: "09:00" });
    setEditing({
      id: svc.id,
      name: svc.name,
      duration: svc.duration,
      price: svc.price,
      service_type: (svc.service_type as 'private' | 'group') || 'private',
      max_capacity: svc.max_capacity ?? 1,
      latest_start_time: latestOf(svc)?.slice(0, 5) ?? "",
      customer_notes_enabled: (svc as { customer_notes_enabled?: boolean }).customer_notes_enabled ?? false,
      customer_notes_placeholder: (svc as { customer_notes_placeholder?: string | null }).customer_notes_placeholder ?? "",
      color: normalizeColor(svc.color),
      // image_url is not in types.ts yet (typed-here-before-regen).
      image_url: imageOf(svc),
      imageFile: null,
      imagePreview: null,
      removeImage: false,
    });
  };

  const todayStr = format(new Date(), "yyyy-MM-dd");
  // Same rule as the sheet: only private services can run in parallel.
  const parallelCount = services.filter((s) => s.service_type !== "group" && s.is_parallel).length;
  const editingSessions = editing?.id ? sessions.filter((s) => s.service_id === editing.id) : [];

  // One line under the name: duration · price (only when > 0, as before) ·
  // latest start · fixed dates · group capacity.
  const summary = (svc: Service) => {
    const parts = [pl("bsMinutes", svc.duration)];
    if (svc.price > 0) parts.push(`₪${svc.price}`);
    const latest = latestOf(svc);
    if (latest) parts.push(t("svUntil").replace("{time}", latest.slice(0, 5)));
    const count = sessions.filter((s) => s.service_id === svc.id).length;
    if (count > 0) parts.push(pl("svDates", count));
    if (svc.service_type === "group") parts.push(`${t("groupClass")} · ${t("maxCapacity")}: ${svc.max_capacity}`);
    return parts.join(" · ");
  };

  const shownImage = editing ? editing.imagePreview ?? (editing.removeImage ? null : editing.image_url) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-6">
      <h2 className="text-lg font-semibold">{t("manageServices")}</h2>

      {/* ── The services ─────────────────────────────────────────────── */}
      {isLoading ? (
        <section className="space-y-2">
          <h3 className={GROUP_HEADING}>{t("svGroupServices")}</h3>
          <div className={cn(LIST, "space-y-px")}>
            {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-foreground/[0.04]" />)}
          </div>
        </section>
      ) : services.length === 0 ? (
        <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Sparkles className="h-6 w-6" />
          </span>
          <p className="mt-3 font-semibold">{t("noServices")}</p>
          <p className="mt-1 text-sm text-foreground/60">{t("svEmptyBody")}</p>
          <Button onClick={openNew} className="mt-5 h-11 gap-1.5 rounded-2xl px-5">
            <Plus className="h-4 w-4" />
            {t("addService")}
          </Button>
        </section>
      ) : (
        <SettingsGroup
          title={t("svGroupServices")}
          action={
            <Button size="sm" variant="ghost" onClick={openNew}
              className="-me-2 h-11 gap-1.5 rounded-2xl px-3 font-semibold text-accent hover:bg-accent/10 hover:text-accent">
              <Plus className="h-4 w-4" />
              {t("addService")}
            </Button>
          }
        >
          {services.map((svc) => (
            <NavRow
              key={svc.id}
              leading={<ServiceTile image={imageOf(svc)} color={serviceColorsEnabled ? normalizeColor(svc.color) : null} group={svc.service_type === "group"} />}
              title={svc.name}
              description={summary(svc)}
              onClick={() => openEdit(svc)}
            />
          ))}
        </SettingsGroup>
      )}

      {/* ── Settings that apply to every service ─────────────────────── */}
      <SettingsGroup title={t("svGroupOptions")}>
        {/* Immediate save, deliberately NOT part of the service sheet's draft:
            flipping a display preference must never dirty an unsaved service.
            While off, the per-service pickers and the row colours stay hidden
            (stored colours are kept). */}
        <SwitchRow
          icon={Palette}
          title={t("serviceColors")}
          description={t("serviceColorsHelper")}
          checked={serviceColorsEnabled}
          onChange={(next) => void handleColorsToggle(next)}
        />
        <NavRow
          icon={Layers}
          title={t("parallelServicesTitle")}
          description={parallelCount > 0 ? `${parallelCount} ${t("parallelServicesActive")}` : t("parallelServicesNone")}
          muted={parallelCount === 0}
          onClick={() => setParallelOpen(true)}
        />
      </SettingsGroup>

      <ParallelServicesSheet open={parallelOpen} onOpenChange={setParallelOpen} />

      {/* ── Add / edit a service ─────────────────────────────────────── */}
      <EditSheet
        open={!!editing}
        onClose={() => { if (!upsertService.isPending) setEditing(null); }}
        icon={editing?.id ? Pencil : Plus}
        title={editing?.id ? t("editServiceTitle") : t("addService")}
        onSave={handleSave}
        saving={upsertService.isPending}
      >
        {editing && (
          <>
            <Field label={t("serviceName")} htmlFor="sv-name">
              <Input id="sv-name" value={editing.name} maxLength={100} className="h-12 rounded-xl"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>

            {/* Service image — optional. The 48px tile matches the customer-side
                service tile, so this is what customers see in the booking flow. */}
            <Field label={t("serviceImage")} help={t("serviceImageHelper")}>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent/10 text-accent">
                  {shownImage ? (
                    <img src={shownImage} alt={editing.name} width={48} height={48} className="h-12 w-12 object-cover" />
                  ) : (
                    <ImageIcon className="h-5 w-5" />
                  )}
                </div>
                <Button type="button" variant="outline" className="h-11 gap-1.5 rounded-2xl" onClick={() => imageInputRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" />
                  {shownImage ? t("replaceImage") : t("uploadImage")}
                </Button>
                {shownImage && (
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-2xl text-red-600 hover:text-red-700"
                    onClick={handleImageRemove} aria-label={t("removeImage")} title={t("removeImage")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              </div>
            </Field>

            {isFitness && (
              <Field label={t("serviceType")}>
                <div className="grid grid-cols-2 gap-1 rounded-2xl bg-foreground/[0.05] p-1" role="radiogroup" aria-label={t("serviceType")}>
                  {([["private", User, "privateService"], ["group", Users, "groupClass"]] as const).map(([type, Icon, label]) => {
                    const on = editing.service_type === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setEditing(type === "private"
                          ? { ...editing, service_type: 'private', max_capacity: 1 }
                          : { ...editing, service_type: 'group', max_capacity: Math.max(2, editing.max_capacity) })}
                        className={cn(
                          "flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-colors",
                          on ? "bg-white text-foreground shadow-sm" : "text-foreground/60",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {t(label)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("duration")} htmlFor="sv-duration">
                <UnitInput id="sv-duration" unit={t("min")} value={editing.duration}
                  onChange={(v) => setEditing({ ...editing, duration: v })} />
              </Field>
              <Field label={t("price")} htmlFor="sv-price">
                <UnitInput id="sv-price" unit="₪" value={editing.price}
                  onChange={(v) => setEditing({ ...editing, price: v })} />
              </Field>
            </div>

            {isFitness && editing.service_type === 'group' && (
              <Field label={t("maxCapacity")} htmlFor="sv-capacity">
                <Input id="sv-capacity" type="number" inputMode="numeric" min={2} max={100} className="h-12 rounded-xl"
                  value={editing.max_capacity}
                  onChange={(e) => setEditing({ ...editing, max_capacity: Math.max(2, Number(e.target.value)) })}
                  onFocus={(e) => e.target.select()} />
              </Field>
            )}

            {/* Per-slot capacity for ordinary (private) services. HIDDEN behind
                SHOW_PRIVATE_CAPACITY (currently false); flip the flag to restore.
                Stores the raw number while typing and clamps to [1,100] on blur;
                handleSave validates the range as a backstop. */}
            {SHOW_PRIVATE_CAPACITY && editing.service_type === 'private' && (
              <Field label={t("maxCustomersPerSlot")} htmlFor="sv-slot-cap" help={t("maxCustomersPerSlotHelp")}>
                <Input id="sv-slot-cap" type="number" min={1} max={100} className="h-12 rounded-xl"
                  value={editing.max_capacity}
                  onChange={(e) => setEditing({ ...editing, max_capacity: Number(e.target.value) })}
                  onBlur={() => setEditing((prev) =>
                    prev ? { ...prev, max_capacity: Math.min(100, Math.max(1, prev.max_capacity || 1)) } : prev)}
                  onFocus={(e) => e.target.select()} />
              </Field>
            )}

            {/* Latest start time — OPTIONAL, and must stay clearable. A bare
                <input type="time"> offers no clear affordance (a touch wheel
                picker can't produce an empty value), so the X button is the only
                reliable way back to "" — which handleSave / upsertService turn
                into a real NULL. While empty the native "--:--" is hidden and the
                overlay reads "No limit" instead. */}
            <Field label={t("svLatestLabel")} htmlFor="sv-latest" help={t("latestStartTimeHelper")}>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="sv-latest"
                    type="time"
                    value={editing.latest_start_time}
                    onChange={(e) => setEditing({ ...editing, latest_start_time: e.target.value })}
                    className={cn("peer h-12 rounded-xl", !editing.latest_start_time && "text-transparent focus:text-foreground")}
                  />
                  {!editing.latest_start_time && (
                    <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-foreground/50 peer-focus:hidden">
                      {t("latestStartTimeNone")}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!editing.latest_start_time}
                  onClick={() => setEditing({ ...editing, latest_start_time: "" })}
                  aria-label={t("latestStartTimeClear")}
                  title={t("latestStartTimeClear")}
                  className="h-11 w-11 shrink-0 rounded-2xl text-foreground/60 disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Field>

            {/* Calendar colour — only while the master switch is on. The stored
                value is untouched when it is off, so turning it on restores it. */}
            {serviceColorsEnabled && (
              <ServiceColorPicker size="lg" value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
            )}

            {/* Customer notes — when on, the booking flow shows the customer an
                optional notes step with the guidance text below. */}
            <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-white">
              <NotesSwitch
                checked={editing.customer_notes_enabled}
                onChange={(v) => setEditing({ ...editing, customer_notes_enabled: v })}
                title={t("customerNotesEnabled")}
                description={t("customerNotesEnabledHelp")}
              />
              <AnimatePresence initial={false}>
                {editing.customer_notes_enabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-foreground/[0.07] px-4 pb-4 pt-3">
                      <Field label={t("customerNotesPlaceholder")} htmlFor="sv-notes">
                        <Input id="sv-notes" value={editing.customer_notes_placeholder} placeholder={DEFAULT_NOTES_PLACEHOLDER}
                          className="h-12 rounded-xl"
                          onChange={(e) => setEditing({ ...editing, customer_notes_placeholder: e.target.value })} />
                      </Field>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Fixed dates — saved services only (a date needs the service id).
                Each add/remove saves IMMEDIATELY through provider_sessions; the
                copy says so, so Cancel is never mistaken for an undo. */}
            {editing.id && (
              <section className="space-y-3 border-t border-foreground/[0.08] pt-5">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarDays className="h-4 w-4 text-accent" />
                    {t("svDatesTitle")}
                  </h3>
                  <p className="mt-1 text-xs leading-snug text-foreground/60">{t("svDatesHelp")}</p>
                </div>
                {editingSessions.length === 0 ? (
                  <p className="text-xs text-foreground/50">{t("svDatesEmpty")}</p>
                ) : (
                  <ul className="overflow-hidden rounded-2xl border border-foreground/10 bg-white">
                    {editingSessions.map((session, i) => {
                      const label = `${format(new Date(session.session_date), "dd/MM/yyyy")} ${session.session_time.slice(0, 5)}`;
                      return (
                        <li key={session.id} className={cn("flex min-h-[48px] items-center gap-3 ps-4", i > 0 && "border-t border-foreground/[0.07]")}>
                          <span dir="ltr" className="flex-1 text-start text-sm font-medium tabular-nums [unicode-bidi:plaintext]">{label}</span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSession(session.id)}
                            aria-label={t("svDateRemove").replace("{date}", label)}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/50 transition-colors hover:text-red-600 active:bg-foreground/[0.06]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("svDateLabel")} htmlFor="sv-date">
                    <Input id="sv-date" type="date" min={todayStr} value={newDate.date} className="h-12 rounded-xl"
                      onChange={(e) => setNewDate({ ...newDate, date: e.target.value })} />
                  </Field>
                  <Field label={t("svTimeLabel")} htmlFor="sv-time">
                    <Input id="sv-time" type="time" value={newDate.time} className="h-12 rounded-xl"
                      onChange={(e) => setNewDate({ ...newDate, time: e.target.value })} />
                  </Field>
                </div>
                <Button type="button" variant="outline" className="h-11 w-full gap-1.5 rounded-2xl"
                  disabled={addSession.isPending} onClick={() => void handleAddSession()}>
                  <CalendarPlus className="h-4 w-4" />
                  {t("svDatesAdd")}
                </Button>
              </section>
            )}

            {editing.id && (
              <div className="border-t border-foreground/[0.08] pt-4">
                <Button type="button" variant="ghost" className="h-11 w-full gap-2 rounded-2xl text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDeleteId(editing.id!)}>
                  <Trash2 className="h-4 w-4" />
                  {t("deleteService")}
                </Button>
              </div>
            )}
          </>
        )}
      </EditSheet>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteServiceConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteServiceConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700"
              disabled={deleteService.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteId) void handleDelete(pendingDeleteId);
              }}
            >
              {t("deleteService")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/** Row tile: the service image when there is one, else an icon; a calendar
 *  colour dot at its corner while service colours are on. */
function ServiceTile({ image, color, group }: { image: string | null; color: string | null; group: boolean }) {
  const Icon = group ? Users : Sparkles;
  return (
    <span className="relative h-10 w-10 shrink-0">
      {image ? (
        <img src={image} alt="" className="h-10 w-10 rounded-xl object-cover" loading="lazy" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      {color && (
        <span
          className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
    </span>
  );
}

/** Number field with its unit inside at the end. Same Number(value) as before. */
function UnitInput({ id, unit, value, onChange }: { id: string; unit: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onFocus={(e) => e.target.select()}
        className="h-12 rounded-xl pe-12 tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-foreground/50">{unit}</span>
    </div>
  );
}

/** The customer-notes switch row inside the service sheet (part of the draft). */
function NotesSwitch({ checked, onChange, title, description }: { checked: boolean; onChange: (v: boolean) => void; title: string; description: string }) {
  return (
    <label className="flex min-h-[56px] cursor-pointer items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-foreground/70">{description}</span>
      </span>
      <SettingsSwitch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}
