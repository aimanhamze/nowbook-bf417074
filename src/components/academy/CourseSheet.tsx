import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BookOpen, Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditSheet, Field, SettingsGroup, SwitchRow } from "@/components/dashboard/SettingsRows";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/translations";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import type { AcademyCourseRow, AcademyInstructorRow } from "@/integrations/supabase/academyTypes";
import { academyErrorMessage } from "@/lib/academyErrors";
import { validateAcademyImage } from "@/lib/academyImage";
import { isHttpsUrl } from "@/lib/academySessions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new course. */
  course: AcademyCourseRow | null;
  instructors: AcademyInstructorRow[];
  /** Called with the saved course's id (e.g. to open its sessions next). */
  onSaved?: (id: string, isNew: boolean) => void;
}

// Form values are the inputs' own strings; numbers are parsed by the schema.
// Each rule mirrors a DB CHECK so the user sees it before the round trip — the
// DB stays the authority and its errors still map through academyErrors.
function buildSchema(t: (k: TranslationKey) => string) {
  const intField = (min: number, msg: TranslationKey) =>
    z
      .string()
      .trim()
      .regex(/^\d+$/, t(msg))
      .refine((v) => Number(v) >= min, t(msg));

  return z
    .object({
      name: z.string().trim().min(1, t("academyErrName")).max(120, t("academyErrName")),
      description: z.string().max(4000, t("academyErrTooLong")),
      instructor_id: z.string().min(1, t("academyCourseInstructorPick")),
      location_type: z.enum(["physical", "online"]),
      address: z.string().max(300, t("academyErrTooLong")),
      online_url: z.string().max(500, t("academyErrTooLong")),
      price: z
        .string()
        .trim()
        .refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), t("academyErrPrice")),
      max_seats: intField(1, "academyErrSeats"),
      cancellation_hours: intField(0, "academyErrCancelHours"),
      is_active: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.location_type === "physical" && v.address.trim() === "") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: t("academyErrLocation") });
      }
      if (v.location_type === "online" && !isHttpsUrl(v.online_url)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["online_url"], message: t("academyErrLocation") });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

function defaultsFor(course: AcademyCourseRow | null, firstInstructorId: string): FormValues {
  return {
    name: course?.name ?? "",
    description: course?.description ?? "",
    instructor_id: course?.instructor_id ?? firstInstructorId,
    location_type: course?.location_type ?? "physical",
    address: course?.address ?? "",
    online_url: course?.online_url ?? "",
    price: course?.price != null ? String(course.price) : "",
    max_seats: course ? String(course.max_seats) : "10",
    cancellation_hours: course ? String(course.cancellation_hours) : "24",
    is_active: course?.is_active ?? true,
  };
}

export function CourseSheet({ open, onOpenChange, course, instructors, onSaved }: Props) {
  const { t } = useLang();
  const { saveCourse } = useAcademyCourses();
  const schema = useMemo(() => buildSchema(t), [t]);

  // Active instructors, plus the course's current one even if it was
  // deactivated since — so an existing course still shows who teaches it.
  const choices = useMemo(
    () => instructors.filter((i) => i.is_active || i.id === course?.instructor_id),
    [instructors, course?.instructor_id],
  );
  const firstActiveId = instructors.find((i) => i.is_active)?.id ?? "";

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(course, firstActiveId),
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fresh form on every open.
  useEffect(() => {
    if (open) {
      reset(defaultsFor(course, firstActiveId));
      setImageFile(null);
      setImagePreview(null);
      setRemoveImage(false);
    }
  }, [open, course, firstActiveId, reset]);

  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const locationType = watch("location_type");
  const shownImage = imagePreview ?? (removeImage ? null : course?.image_url ?? null);

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const invalid = validateAcademyImage(file);
    if (invalid) {
      toast.error(academyErrorMessage(new Error(invalid), t));
      return;
    }
    setImageFile(file);
    setRemoveImage(false);
  };

  const onSubmit = async (v: FormValues) => {
    const isPhysical = v.location_type === "physical";
    try {
      const result = await saveCourse.mutateAsync({
        id: course?.id,
        values: {
          name: v.name.trim(),
          description: v.description.trim() === "" ? null : v.description.trim(),
          instructor_id: v.instructor_id,
          location_type: v.location_type,
          address: isPhysical ? v.address.trim() : null,
          online_url: isPhysical ? null : v.online_url.trim(),
          price: v.price === "" ? null : Number(v.price),
          max_seats: Number(v.max_seats),
          cancellation_hours: Number(v.cancellation_hours),
          is_active: v.is_active,
        },
        imageFile,
        removeImage,
      });
      if (result.imageError) toast.error(t("academyErrImageUpload"));
      else toast.success(t("academyCourseSaved"));
      onOpenChange(false);
      onSaved?.(result.id, !course);
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const err = (name: keyof FormValues) => errors[name]?.message ?? null;
  const inputCls = (name: keyof FormValues) => cn("h-12 rounded-xl", errors[name] && "border-red-600");
  const saving = isSubmitting || saveCourse.isPending;

  return (
    <EditSheet
      open={open}
      onClose={() => onOpenChange(false)}
      icon={BookOpen}
      title={course ? t("academyCourseEdit") : t("academyCourseAdd")}
      onSave={() => void handleSubmit(onSubmit)()}
      saving={saving}
    >
      {/* Image */}
      <div className="flex items-center gap-3">
        <span className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-foreground/15 bg-foreground/[0.03] text-foreground/40">
          {shownImage ? <img src={shownImage} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SheetButton icon={Camera} onClick={() => fileRef.current?.click()}>
            {shownImage ? t("academyInstructorPhotoChange") : t("academyCourseImage")}
          </SheetButton>
          {shownImage && (
            <SheetButton
              icon={Trash2}
              onClick={() => {
                setImageFile(null);
                setImagePreview(null);
                setRemoveImage(true);
              }}
            >
              {t("academyInstructorPhotoRemove")}
            </SheetButton>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} aria-label={t("academyCourseImage")} />
      </div>

      <Field label={t("academyCourseName")} htmlFor="course-name" error={err("name")}>
        <Input id="course-name" maxLength={120} {...register("name")} className={inputCls("name")} />
      </Field>

      <Field label={t("academyCourseDescription")} htmlFor="course-description" error={err("description")}>
        <Textarea id="course-description" rows={3} maxLength={4000} {...register("description")} className="rounded-xl" />
      </Field>

      <Field label={t("academyCourseInstructor")} error={err("instructor_id")}>
        <Controller
          name="instructor_id"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-12 rounded-xl" aria-label={t("academyCourseInstructor")}>
                <SelectValue placeholder={t("academyCourseInstructorPick")} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                    {!i.is_active && ` ${t("academyCourseInstructorInactiveTag")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      <Field label={t("academyCourseLocation")}>
        <Controller
          name="location_type"
          control={control}
          render={({ field }) => (
            <div
              className="grid grid-cols-2 gap-1 rounded-2xl bg-foreground/[0.05] p-1"
              role="radiogroup"
              aria-label={t("academyCourseLocation")}
            >
              {(["physical", "online"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={field.value === kind}
                  onClick={() => field.onChange(kind)}
                  className={cn(
                    "h-11 rounded-xl text-sm font-semibold transition-colors",
                    field.value === kind ? "bg-white text-accent shadow-sm" : "text-foreground/60",
                  )}
                >
                  {kind === "physical" ? t("academyCoursePhysical") : t("academyCourseOnline")}
                </button>
              ))}
            </div>
          )}
        />
      </Field>

      {locationType === "physical" ? (
        <Field label={t("academyCourseAddress")} htmlFor="course-address" error={err("address")}>
          <Input id="course-address" maxLength={300} {...register("address")} className={inputCls("address")} />
        </Field>
      ) : (
        <Field label={t("academyCourseOnlineUrl")} htmlFor="course-url" error={err("online_url")}>
          <Input
            id="course-url"
            type="url"
            dir="ltr"
            inputMode="url"
            placeholder="https://"
            maxLength={500}
            {...register("online_url")}
            className={cn(inputCls("online_url"), "text-start")}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("academyCourseSeats")} htmlFor="course-seats" error={err("max_seats")}>
          <Input id="course-seats" inputMode="numeric" {...register("max_seats")} className={inputCls("max_seats")} />
        </Field>
        <Field label={t("academyCoursePrice")} htmlFor="course-price" error={err("price")}>
          <Input id="course-price" inputMode="decimal" placeholder="₪" {...register("price")} className={inputCls("price")} />
        </Field>
      </div>
      <p className="-mt-2 text-xs leading-snug text-foreground/60">{t("academyCoursePriceHelp")}</p>

      <Field label={t("academyCourseCancelHours")} htmlFor="course-cancel" error={err("cancellation_hours")}>
        <Input
          id="course-cancel"
          inputMode="numeric"
          {...register("cancellation_hours")}
          className={inputCls("cancellation_hours")}
        />
      </Field>

      <Controller
        name="is_active"
        control={control}
        render={({ field }) => (
          <SettingsGroup plain>
            <SwitchRow
              title={t("academyCourseActive")}
              description={t("academyCourseActiveHelp")}
              checked={field.value}
              onChange={field.onChange}
            />
          </SettingsGroup>
        )}
      />
    </EditSheet>
  );
}

function SheetButton({ icon: Icon, onClick, children }: { icon: typeof Camera; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 min-w-0 items-center gap-2 rounded-2xl border border-foreground/10 bg-white px-3 text-sm font-medium transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-accent" />
      <span className="truncate">{children}</span>
    </button>
  );
}
