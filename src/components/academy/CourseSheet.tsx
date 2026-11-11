import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { useLang } from "@/contexts/LangContext";
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
  const { saveCourse, deleteCourse } = useAcademyCourses();
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const onDelete = async () => {
    if (!course) return;
    try {
      await deleteCourse.mutateAsync({ id: course.id });
      toast.success(t("academyCourseDeleted"));
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const fieldError = (name: keyof FormValues) =>
    errors[name]?.message ? <p className="mt-1 text-xs text-destructive">{errors[name]?.message}</p> : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={`max-h-[92vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}>
        <SheetHeader>
          <SheetTitle>
            {course ? t("academyCourseEdit") : t("academyCourseAdd")}
            <BranchSuffix />
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4" noValidate>
          {/* Image */}
          <div>
            <Label>{t("academyCourseImage")}</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-secondary/40 text-muted-foreground"
                aria-label={t("academyCourseImage")}
              >
                {shownImage ? (
                  <img src={shownImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6" />
                )}
              </button>
              {shownImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    setRemoveImage(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("academyInstructorPhotoRemove")}
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
            </div>
          </div>

          <div>
            <Label htmlFor="course-name">{t("academyCourseName")}</Label>
            <Input id="course-name" maxLength={120} {...register("name")} className="mt-1.5" />
            {fieldError("name")}
          </div>

          <div>
            <Label htmlFor="course-description">{t("academyCourseDescription")}</Label>
            <Textarea id="course-description" rows={3} maxLength={4000} {...register("description")} className="mt-1.5" />
            {fieldError("description")}
          </div>

          <div>
            <Label>{t("academyCourseInstructor")}</Label>
            <Controller
              name="instructor_id"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="mt-1.5">
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
            {fieldError("instructor_id")}
          </div>

          <div>
            <Label>{t("academyCourseLocation")}</Label>
            <Controller
              name="location_type"
              control={control}
              render={({ field }) => (
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-secondary/80 p-1" role="radiogroup">
                  {(["physical", "online"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={field.value === kind}
                      onClick={() => field.onChange(kind)}
                      className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                        field.value === kind ? "bg-card text-accent shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      {kind === "physical" ? t("academyCoursePhysical") : t("academyCourseOnline")}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {locationType === "physical" ? (
            <div>
              <Label htmlFor="course-address">{t("academyCourseAddress")}</Label>
              <Input id="course-address" maxLength={300} {...register("address")} className="mt-1.5" />
              {fieldError("address")}
            </div>
          ) : (
            <div>
              <Label htmlFor="course-url">{t("academyCourseOnlineUrl")}</Label>
              <Input
                id="course-url"
                type="url"
                dir="ltr"
                inputMode="url"
                placeholder="https://"
                maxLength={500}
                {...register("online_url")}
                className="mt-1.5"
              />
              {fieldError("online_url")}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="course-seats">{t("academyCourseSeats")}</Label>
              <Input id="course-seats" inputMode="numeric" {...register("max_seats")} className="mt-1.5" />
              {fieldError("max_seats")}
            </div>
            <div>
              <Label htmlFor="course-price">{t("academyCoursePrice")}</Label>
              <Input id="course-price" inputMode="decimal" placeholder="₪" {...register("price")} className="mt-1.5" />
              {fieldError("price")}
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("academyCoursePriceHelp")}</p>

          <div>
            <Label htmlFor="course-cancel">{t("academyCourseCancelHours")}</Label>
            <Input id="course-cancel" inputMode="numeric" {...register("cancellation_hours")} className="mt-1.5" />
            {fieldError("cancellation_hours")}
          </div>

          <Controller
            name="is_active"
            control={control}
            render={({ field }) => (
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={t("academyCourseActive")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t("academyCourseActive")}</p>
                  <p className="text-xs text-muted-foreground">{t("academyCourseActiveHelp")}</p>
                </div>
              </div>
            )}
          />

          <Button type="submit" className="h-12 w-full text-base font-semibold" disabled={isSubmitting || saveCourse.isPending}>
            {t("save")}
          </Button>

          {course && (
            <Button
              type="button"
              variant="ghost"
              className="w-full gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t("academyCourseDelete")}
            </Button>
          )}
        </form>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("academyCourseDeleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("academyCourseDeleteBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteCourse.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  void onDelete();
                }}
              >
                {t("academyDelete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
