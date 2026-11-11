import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlignLeft, BellRing, Camera, Check, ImageIcon, Loader2, LocateFixed, MapPin, Phone, RotateCcw,
  Share2, Store, Tag, Wallet,
} from "lucide-react";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUserLocation } from "@/hooks/useUserLocation";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { usePlural } from "@/hooks/usePlural";
import { categories, categoryNames } from "@/lib/mock-data";
import { buildSocialLinks, type SocialLinks } from "@/lib/socialLinks";
import type { TranslationKey } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EditSheet, Field, NavRow, SettingsGroup } from "./SettingsRows";

export const DEFAULT_DEPOSIT_TEMPLATE = `שלום {customer_name} 😊
קיבלנו את בקשת התור שלך ל{service_name} בתאריך {date} בשעה {time}.
לאישור התור נדרש תשלום מקדמה של ₪{price}.`;

export const DEFAULT_REMINDER_TEMPLATE = `שלום {customer_name} 😊
רצינו להזכיר לך את התור שקבעת אצלנו:
📅 תאריך: {date}
⏰ שעה: {time}
💇 שירות: {service_name}
מצפים לראותך! 🙏`;

const DEPOSIT_PLACEHOLDERS = ["{customer_name}", "{service_name}", "{date}", "{time}", "{price}"];
const REMINDER_PLACEHOLDERS = ["{customer_name}", "{service_name}", "{date}", "{time}"];

function roundCoord(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const SOCIAL_FIELDS = [
  "social_whatsapp", "social_instagram", "social_tiktok", "social_facebook", "social_waze", "social_website",
] as const;

// Same schema, bounds and defaults as the single form this replaced; only the
// messages are now translation keys (resolved with t() where shown).
const profileSchema = z.object({
  business_name: z.string().min(2, "pfErrNameShort").max(100, "pfErrTooLong"),
  category: z.string().min(1),
  address: z.string().max(200, "pfErrTooLong").optional().default(""),
  about: z.string().max(1000, "pfErrTooLong").optional().default(""),
  phone: z.string().regex(/^[+\d\s\-()]*$/, "pfErrPhone").max(20, "pfErrPhone").optional().default(""),
  social_whatsapp: z.string().optional().default(""),
  social_instagram: z.string().optional().default(""),
  social_tiktok: z.string().optional().default(""),
  social_facebook: z.string().optional().default(""),
  social_waze: z.string().optional().default(""),
  social_website: z.string().optional().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

type FormValues = z.infer<typeof profileSchema>;
type FieldName = keyof FormValues;
type FieldErrors = Partial<Record<FieldName, string>>;

type ProfileRow = NonNullable<ReturnType<typeof useProviderProfile>["profile"]>;

/** The stored profile as form values — exactly the reset() the old form ran,
 *  including WhatsApp falling back to the business phone. */
function storedValues(profile: ProfileRow): FormValues {
  const sl = profile.social_links as SocialLinks | null;
  return {
    business_name: profile.business_name || "",
    category: profile.category || "barber",
    address: profile.address || "",
    about: profile.about || "",
    phone: profile.phone || "",
    social_whatsapp: sl?.whatsapp || profile.phone || "",
    social_instagram: sl?.instagram || "",
    social_tiktok: sl?.tiktok || "",
    social_facebook: sl?.facebook || "",
    social_waze: sl?.waze || "",
    social_website: sl?.website || "",
    latitude: profile.latitude ?? null,
    longitude: profile.longitude ?? null,
  };
}

/** The upsertProfile payload — the same shape and conversions the old form's
 *  submit sent, every field included. */
function toPayload(values: FormValues) {
  return {
    business_name: values.business_name,
    category: values.category,
    address: values.address ?? "",
    about: values.about ?? "",
    phone: values.phone ?? "",
    social_links: buildSocialLinks({
      social_whatsapp: values.social_whatsapp ?? "",
      social_instagram: values.social_instagram ?? "",
      social_tiktok: values.social_tiktok ?? "",
      social_facebook: values.social_facebook ?? "",
      social_waze: values.social_waze ?? "",
      social_website: values.social_website ?? "",
    }),
    latitude: values.latitude ?? null,
    longitude: values.longitude ?? null,
  };
}

type SheetId = "name" | "category" | "about" | "phone" | "social" | "address" | "pin";
type TemplateId = "deposit" | "reminder";

// Which form fields each sheet edits. Every other field is sent as stored.
const SHEET_FIELDS: Record<SheetId, FieldName[]> = {
  name: ["business_name"],
  category: ["category"],
  about: ["about"],
  phone: ["phone"],
  social: [...SOCIAL_FIELDS],
  address: ["address"],
  pin: ["latitude", "longitude"],
};

// Each sheet saves on its own Save, sending the full upsertProfile payload
// with the stored values for every field it does not edit. An unchanged Save
// writes nothing. Uploads still save the moment a file is picked. Every write
// targets the active branch (useProviderProfile → profile.id), and the
// dashboard remounts this section when the branch changes.
export function BusinessProfileTab() {
  const { t, lang } = useLang();
  const pl = usePlural();
  const { profile, upsertProfile, updateWhatsAppTemplates, uploadCoverImage, uploadAvatarImage } = useProviderProfile();

  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [templateSheet, setTemplateSheet] = useState<TemplateId | null>(null);
  const [templateDraft, setTemplateDraft] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const {
    position: detectedPosition,
    isLocating: isDetectingLocation,
    errorCode: locationErrorCode,
    locate,
  } = useUserLocation();

  // A detected position lands in the open pin sheet's draft; it is saved only
  // by that sheet's Save, as before (it used to dirty the form).
  useEffect(() => {
    if (!detectedPosition) return;
    setDraft((d) => d && {
      ...d,
      latitude: roundCoord(detectedPosition.latitude),
      longitude: roundCoord(detectedPosition.longitude),
    });
  }, [detectedPosition]);

  useEffect(() => {
    if (locationErrorCode === null) return;
    if (locationErrorCode === -1) toast.error(t("locationErrorUnsupported"));
    else if (locationErrorCode === 1) toast.error(t("locationErrorDenied"));
    else if (locationErrorCode === 2) toast.error(t("locationErrorUnavailable"));
    else if (locationErrorCode === 3) toast.error(t("locationErrorTimeout"));
  }, [locationErrorCode, t]);

  if (!profile) return null;
  const stored = storedValues(profile);

  const openSheet = (id: SheetId) => {
    setDraft(storedValues(profile));
    setErrors({});
    setSheet(id);
  };
  const closeSheet = () => {
    if (upsertProfile.isPending) return;
    setSheet(null);
  };
  const set = (patch: Partial<FormValues>) => {
    setDraft((d) => d && { ...d, ...patch });
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as FieldName[]) delete next[k];
      return next;
    });
  };

  const saveSheet = async () => {
    if (!sheet || !draft || upsertProfile.isPending) return;
    const fields = SHEET_FIELDS[sheet];
    // Only this sheet's fields change; the rest are the stored values.
    const merged: FormValues = { ...storedValues(profile) };
    for (const f of fields) (merged as Record<string, unknown>)[f] = draft[f];
    if (fields.every((f) => (merged[f] ?? null) === (stored[f] ?? null))) {
      setSheet(null);
      return;
    }
    const parsed = profileSchema.safeParse(merged);
    if (!parsed.success) {
      const next: FieldErrors = {};
      let elsewhere: string | null = null;
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        // Our rules carry a translation key; zod's built-in ones (type checks)
        // carry English text, which is never shown.
        const message = issue.message.startsWith("pfErr")
          ? t(issue.message as TranslationKey)
          : t("bsSaveError");
        if (fields.includes(field)) next[field] ??= message;
        else elsewhere ??= message;
      }
      setErrors(next);
      // A stored field elsewhere is invalid: the same full-payload save would
      // fail, so say which rule it broke rather than failing silently.
      if (elsewhere && Object.keys(next).length === 0) toast.error(elsewhere);
      return;
    }
    try {
      await upsertProfile.mutateAsync(toPayload(parsed.data));
      toast.success(t("profileSaved"));
      setSheet(null);
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const openTemplate = (id: TemplateId) => {
    setTemplateDraft(
      id === "deposit"
        ? profile.deposit_message_template || DEFAULT_DEPOSIT_TEMPLATE
        : profile.reminder_message_template || DEFAULT_REMINDER_TEMPLATE,
    );
    setTemplateSheet(id);
  };
  const saveTemplate = async () => {
    if (!templateSheet || updateWhatsAppTemplates.isPending) return;
    const current = templateSheet === "deposit"
      ? profile.deposit_message_template || DEFAULT_DEPOSIT_TEMPLATE
      : profile.reminder_message_template || DEFAULT_REMINDER_TEMPLATE;
    if (templateDraft === current) {
      setTemplateSheet(null);
      return;
    }
    try {
      await updateWhatsAppTemplates.mutateAsync(
        templateSheet === "deposit"
          ? { deposit_message_template: templateDraft }
          : { reminder_message_template: templateDraft },
      );
      toast.success(t("templateSaved"));
      setTemplateSheet(null);
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const upload = (kind: "avatar" | "cover") => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (kind === "avatar") {
        await uploadAvatarImage.mutateAsync(file);
        toast.success(t("avatarUploaded"));
      } else {
        await uploadCoverImage.mutateAsync(file);
        toast.success(t("coverImageUploaded"));
      }
    } catch {
      toast.error(t("coverImageUploadError"));
    } finally {
      event.target.value = "";
    }
  };

  // ── Row values ──────────────────────────────────────────────────────────
  const categoryLabel = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? `${c.icon} ${categoryNames[id]?.[lang] ?? id}` : id;
  };
  const socialCount = SOCIAL_FIELDS.filter((f) => (stored[f] ?? "").trim() !== "").length;
  const hasPin = stored.latitude != null && stored.longitude != null;
  const isCustom = (value: string | null | undefined, fallback: string) => !!value && value !== fallback;
  const initial = (profile.business_name || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarBusy = uploadAvatarImage.isPending;
  const coverBusy = uploadCoverImage.isPending;

  const draftPin = draft && draft.latitude != null && draft.longitude != null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-6">
      <h2 className="text-lg font-semibold">{t("businessProfile")}</h2>

      {/* ── Branding: how the business page opens ─────────────────────── */}
      <section className="glass-card-md overflow-hidden rounded-3xl">
        <div className="relative h-36 bg-gradient-to-br from-accent/20 to-accent/5">
          {profile.cover_image?.trim() ? (
            <img src={profile.cover_image} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl font-bold text-accent/35" aria-hidden>
              {initial}
            </div>
          )}
          {coverBusy && <UploadVeil label={t("pfUploading")} />}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end gap-3">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-[hsl(30_60%_96%)] to-[hsl(24_70%_90%)] ring-4 ring-white">
              {profile.avatar_image ? (
                <img src={profile.avatar_image} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-accent/50" aria-hidden>
                  {initial}
                </div>
              )}
              {avatarBusy && <UploadVeil />}
            </div>
            <div className="min-w-0 pb-1">
              <p className="truncate text-base font-semibold leading-snug">{profile.business_name || "—"}</p>
              <p className="truncate text-xs text-foreground/60">{categoryLabel(stored.category)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ImageButton icon={Camera} label={t("pfPhotoBtn")} busy={avatarBusy} onClick={() => avatarInput.current?.click()} />
            <ImageButton icon={ImageIcon} label={t("pfCoverBtn")} busy={coverBusy} onClick={() => coverInput.current?.click()} />
          </div>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={upload("avatar")} aria-label={t("pfPhotoBtn")} />
          <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={upload("cover")} aria-label={t("pfCoverBtn")} />
        </div>
      </section>

      <SettingsGroup title={t("pfGroupDetails")}>
        <NavRow icon={Store} title={t("pfNameTitle")} description={stored.business_name || t("pfNotSet")}
          muted={!stored.business_name} onClick={() => openSheet("name")} />
        <NavRow icon={Tag} title={t("pfCategoryTitle")} description={categoryLabel(stored.category)}
          onClick={() => openSheet("category")} />
        <NavRow icon={AlignLeft} title={t("pfAboutTitle")} description={stored.about?.trim() || t("pfAboutEmpty")}
          muted={!stored.about?.trim()} lines={2} onClick={() => openSheet("about")} />
      </SettingsGroup>

      <SettingsGroup title={t("pfGroupContact")}>
        <NavRow icon={Phone} title={t("pfPhoneTitle")} description={stored.phone || t("pfNotSet")}
          descriptionDir={stored.phone ? "ltr" : undefined} muted={!stored.phone} onClick={() => openSheet("phone")} />
        <NavRow icon={Share2} title={t("pfSocialTitle")}
          description={socialCount > 0 ? pl("pfSocialCount", socialCount) : t("pfSocialNone")}
          muted={socialCount === 0} onClick={() => openSheet("social")} />
      </SettingsGroup>

      <SettingsGroup title={t("pfGroupLocation")}>
        <NavRow icon={MapPin} title={t("pfAddressTitle")} description={stored.address || t("pfNotSet")}
          muted={!stored.address} onClick={() => openSheet("address")} />
        <NavRow icon={LocateFixed} title={t("pfPinTitle")} description={t(hasPin ? "pfPinSet" : "pfPinNotSet")}
          muted={!hasPin} onClick={() => openSheet("pin")} />
      </SettingsGroup>

      <SettingsGroup title={t("pfGroupMessages")}>
        <NavRow icon={Wallet} title={t("pfDepositTitle")}
          description={t(isCustom(profile.deposit_message_template, DEFAULT_DEPOSIT_TEMPLATE) ? "pfTemplateCustom" : "pfTemplateDefault")}
          onClick={() => openTemplate("deposit")} />
        <NavRow icon={BellRing} title={t("pfReminderTitle")}
          description={t(isCustom(profile.reminder_message_template, DEFAULT_REMINDER_TEMPLATE) ? "pfTemplateCustom" : "pfTemplateDefault")}
          onClick={() => openTemplate("reminder")} />
      </SettingsGroup>

      {/* ── Field sheets ────────────────────────────────────────────────── */}
      <EditSheet open={sheet === "name"} onClose={closeSheet} icon={Store} title={t("pfNameTitle")}
        onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <Field label={t("pfNameTitle")} htmlFor="pf-name" error={errors.business_name}>
            <Input id="pf-name" value={draft.business_name} maxLength={100} autoComplete="organization"
              onChange={(e) => set({ business_name: e.target.value })}
              className={cn("h-12 rounded-xl", errors.business_name && "border-red-600")} />
          </Field>
        )}
      </EditSheet>

      <EditSheet open={sheet === "category"} onClose={closeSheet} icon={Tag} title={t("pfCategoryTitle")}
        onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <ul className="space-y-1" role="radiogroup" aria-label={t("pfCategoryTitle")}>
            {categories.map((c) => {
              const selected = draft.category === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set({ category: c.id })}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      selected ? "bg-accent/10 font-semibold" : "active:bg-foreground/[0.04]",
                    )}
                  >
                    <span className="text-lg leading-none" aria-hidden>{c.icon}</span>
                    <span className="flex-1">{categoryNames[c.id]?.[lang]}</span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={3} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </EditSheet>

      <EditSheet open={sheet === "about"} onClose={closeSheet} icon={AlignLeft} title={t("pfAboutTitle")}
        onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <Field label={t("pfAboutTitle")} htmlFor="pf-about" error={errors.about}
            help={<span className="flex justify-between gap-3"><span>{t("pfAboutHelp")}</span><span dir="ltr" className="tabular-nums">{(draft.about ?? "").length}/1000</span></span>}>
            <Textarea id="pf-about" rows={7} value={draft.about ?? ""} maxLength={1000}
              onChange={(e) => set({ about: e.target.value })} className="rounded-xl text-sm leading-relaxed" />
          </Field>
        )}
      </EditSheet>

      <EditSheet open={sheet === "phone"} onClose={closeSheet} icon={Phone} title={t("pfPhoneTitle")}
        onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <Field label={t("pfPhoneTitle")} htmlFor="pf-phone" error={errors.phone}>
            <Input id="pf-phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={draft.phone ?? ""}
              onChange={(e) => set({ phone: e.target.value })}
              className={cn("h-12 rounded-xl text-start", errors.phone && "border-red-600")} />
          </Field>
        )}
      </EditSheet>

      <EditSheet open={sheet === "social"} onClose={closeSheet} icon={Share2} title={t("pfSocialTitle")}
        description={t("pfSocialHelp")} onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <>
            <SocialInput id="pf-wa" label={t("socialLinksWhatsapp")} help={t("socialLinksHelperPhone")} type="tel"
              value={draft.social_whatsapp ?? ""} onChange={(v) => set({ social_whatsapp: v })} />
            <SocialInput id="pf-ig" label={t("socialLinksInstagram")} help={t("socialLinksHelperHandle")}
              value={draft.social_instagram ?? ""} onChange={(v) => set({ social_instagram: v })} />
            <SocialInput id="pf-tt" label={t("socialLinksTiktok")} help={t("socialLinksHelperHandle")}
              value={draft.social_tiktok ?? ""} onChange={(v) => set({ social_tiktok: v })} />
            <SocialInput id="pf-fb" label={t("socialLinksFacebook")} help={t("socialLinksHelperHandle")}
              value={draft.social_facebook ?? ""} onChange={(v) => set({ social_facebook: v })} />
            <SocialInput id="pf-wz" label={t("socialLinksWaze")} help={t("socialLinksHelperWaze")}
              value={draft.social_waze ?? ""} onChange={(v) => set({ social_waze: v })} />
            <SocialInput id="pf-web" label={t("socialLinksWebsite")} help={t("socialLinksHelperWebsite")} type="url"
              value={draft.social_website ?? ""} onChange={(v) => set({ social_website: v })} />
          </>
        )}
      </EditSheet>

      <EditSheet open={sheet === "address"} onClose={closeSheet} icon={MapPin} title={t("pfAddressTitle")}
        onSave={saveSheet} saving={upsertProfile.isPending}>
        {draft && (
          <Field label={t("pfAddressTitle")} htmlFor="pf-address" help={t("pfAddressHelp")} error={errors.address}>
            <Input id="pf-address" value={draft.address ?? ""} maxLength={200} autoComplete="street-address"
              onChange={(e) => set({ address: e.target.value })} className="h-12 rounded-xl" />
          </Field>
        )}
      </EditSheet>

      <EditSheet open={sheet === "pin"} onClose={closeSheet} icon={LocateFixed} title={t("pfPinTitle")}
        description={t("locationHelperText")} onSave={saveSheet} saving={upsertProfile.isPending}
        saveDisabled={isDetectingLocation}>
        {draft && (
          <>
            <div className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3",
              draftPin ? "bg-emerald-50 text-emerald-800" : "bg-foreground/[0.04] text-foreground/70",
            )}>
              <MapPin className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t(draftPin ? "pfPinSet" : "pfPinNotSet")}</p>
                {draftPin && (
                  <p dir="ltr" className="text-start text-xs tabular-nums [unicode-bidi:plaintext]">
                    {draft.latitude!.toFixed(4)}, {draft.longitude!.toFixed(4)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button type="button" variant={draftPin ? "outline" : "default"} className="h-12 rounded-2xl"
                disabled={isDetectingLocation} onClick={locate}>
                {isDetectingLocation ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />{t("locationDetecting")}</>
                ) : (
                  <><LocateFixed className="h-4 w-4" />{t(draftPin ? "locationUpdateLocation" : "locationSetCurrentLocation")}</>
                )}
              </Button>
              {draftPin && !isDetectingLocation && (
                <Button type="button" variant="ghost" className="h-11 rounded-2xl text-red-600 hover:text-red-700"
                  onClick={() => set({ latitude: null, longitude: null })}>
                  {t("locationClearLocation")}
                </Button>
              )}
            </div>
            <div className="space-y-1.5 text-xs leading-snug text-foreground/60">
              <p>{t("locationPrivacyNote")}</p>
              <p>{t("pfPinWazeNote")}</p>
            </div>
          </>
        )}
      </EditSheet>

      {/* ── WhatsApp message templates ──────────────────────────────────── */}
      <EditSheet
        open={templateSheet !== null}
        onClose={() => { if (!updateWhatsAppTemplates.isPending) setTemplateSheet(null); }}
        icon={templateSheet === "reminder" ? BellRing : Wallet}
        title={t(templateSheet === "reminder" ? "pfReminderTitle" : "pfDepositTitle")}
        description={t("pfTemplateHelp")}
        onSave={saveTemplate}
        saving={updateWhatsAppTemplates.isPending}
      >
        {templateSheet && (
          <>
            <Textarea
              rows={templateSheet === "reminder" ? 8 : 6}
              value={templateDraft}
              onChange={(e) => setTemplateDraft(e.target.value)}
              aria-label={t(templateSheet === "reminder" ? "pfReminderTitle" : "pfDepositTitle")}
              className="rounded-xl text-sm leading-relaxed"
            />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground/60">{t("availablePlaceholders")}</p>
              <div className="flex flex-wrap gap-1.5" dir="ltr">
                {(templateSheet === "deposit" ? DEPOSIT_PLACEHOLDERS : REMINDER_PLACEHOLDERS).map((p) => (
                  <code key={p} className="rounded-lg bg-foreground/[0.06] px-2 py-1 text-[11px] text-foreground/80">{p}</code>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2 rounded-2xl"
              onClick={() => setTemplateDraft(templateSheet === "deposit" ? DEFAULT_DEPOSIT_TEMPLATE : DEFAULT_REMINDER_TEMPLATE)}
            >
              <RotateCcw className="h-4 w-4" />
              {t("resetToDefault")}
            </Button>
          </>
        )}
      </EditSheet>
    </motion.div>
  );
}

function UploadVeil({ label }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-sm font-medium text-white">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  );
}

function ImageButton({
  icon: Icon, label, busy, onClick,
}: { icon: typeof Camera; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-white/70 px-3 text-sm font-medium transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Icon className="h-4 w-4 shrink-0 text-accent" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function SocialInput({
  id, label, help, value, onChange, type = "text",
}: { id: string; label: string; help: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Input id={id} type={type} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-12 rounded-xl text-start" />
    </Field>
  );
}
