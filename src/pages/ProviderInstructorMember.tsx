import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlignLeft, Camera, Loader2, Trash2, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { ProviderPageTitle } from "@/components/branch/ProviderPageTitle";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { EditSheet, Field, NavRow, SettingsGroup, SwitchRow } from "@/components/dashboard/SettingsRows";
import { LIST } from "@/components/dashboard/settingsList";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import { InstructorDeactivateDialog } from "@/components/academy/InstructorDeactivateDialog";
import { academyErrorMessage } from "@/lib/academyErrors";
import { validateAcademyImage } from "@/lib/academyImage";
import { isAcademyCategory } from "@/lib/academyCategory";
import { cn } from "@/lib/utils";

const NAME_MAX = 120;
const BIO_MAX = 2000;

/**
 * /instructors/:id and /instructors/new — the academy twin of /staff/:id.
 *
 * /new is a name and a button (the photo path needs the row id first). The
 * member view is rows, like the business profile: the photo (upload /
 * replace / remove), name and about — each opens a sheet with its own Save —
 * and the active switch (turning OFF is confirmed). Every write is the same
 * single-column update as before and reports its own failure.
 */
export default function ProviderInstructorMember() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const isNew = id === "new";

  const { profile } = useProviderProfile();
  const {
    instructors,
    isLoading,
    createInstructor,
    updateInstructor,
    setInstructorPhoto,
    removeInstructorPhoto,
  } = useAcademyInstructors();

  const instructor = useMemo(() => instructors.find((i) => i.id === id), [instructors, id]);

  const [newName, setNewName] = useState("");
  const [sheet, setSheet] = useState<"name" | "bio" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user && !isProvider) navigate("/", { replace: true });
  }, [user, isProvider, navigate]);

  useEffect(() => {
    if (profile && !isAcademyCategory(profile.category)) navigate("/profile", { replace: true });
  }, [profile, navigate]);

  const fail = (err: unknown) => toast.error(academyErrorMessage(err, t));

  const create = async () => {
    const name = newName.trim();
    if (!name || name.length > NAME_MAX) {
      toast.error(t("academyErrName"));
      return;
    }
    try {
      const newId = await createInstructor.mutateAsync({ name });
      toast.success(t("academyInstructorSaved"));
      navigate(`/instructors/${newId}`, { replace: true });
    } catch (err) {
      fail(err);
    }
  };

  // Each sheet starts from the stored value.
  const openSheet = (which: "name" | "bio") => {
    if (!instructor) return;
    setNameDraft(instructor.name);
    setBioDraft(instructor.bio ?? "");
    setSheet(which);
  };
  const closeSheet = () => setSheet(null);

  const saveName = async () => {
    if (!instructor) return;
    const name = nameDraft.trim();
    if (!name || name.length > NAME_MAX) {
      toast.error(t("academyErrName"));
      return;
    }
    // An unchanged Save writes nothing.
    if (name !== instructor.name) {
      try {
        await updateInstructor.mutateAsync({ id: instructor.id, patch: { name } });
        toast.success(t("academyInstructorSaved"));
      } catch (err) {
        fail(err);
        return;
      }
    }
    closeSheet();
  };

  const saveBio = async () => {
    if (!instructor) return;
    const bio = bioDraft.trim();
    try {
      await updateInstructor.mutateAsync({ id: instructor.id, patch: { bio: bio === "" ? null : bio } });
      toast.success(t("academyInstructorSaved"));
      closeSheet();
    } catch (err) {
      fail(err);
    }
  };

  const setActive = async (is_active: boolean) => {
    if (!instructor) return;
    try {
      await updateInstructor.mutateAsync({ id: instructor.id, patch: { is_active } });
      toast.success(is_active ? t("academyInstructorActivated") : t("academyInstructorDeactivated"));
    } catch (err) {
      fail(err);
    } finally {
      setConfirmDeactivate(false);
    }
  };

  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !instructor) return;
    const invalid = validateAcademyImage(file);
    if (invalid) {
      fail(new Error(invalid));
      return;
    }
    try {
      await setInstructorPhoto.mutateAsync({ id: instructor.id, file });
      toast.success(t("academyInstructorSaved"));
    } catch (err) {
      fail(err);
    }
  };

  const removePhoto = async () => {
    if (!instructor) return;
    try {
      await removeInstructorPhoto.mutateAsync({ id: instructor.id });
      toast.success(t("academyInstructorSaved"));
    } catch (err) {
      fail(err);
    }
  };

  if (!user || !isProvider) return null;

  const photoBusy = setInstructorPhoto.isPending || removeInstructorPhoto.isPending;
  const bioDirty = instructor ? bioDraft.trim() !== (instructor.bio ?? "") : false;
  const bio = instructor?.bio?.trim() ?? "";

  return (
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        <header className="flex items-center gap-1 px-5 pt-12 pb-3">
          <button
            onClick={() => navigate("/instructors")}
            className="-ms-3 flex h-11 w-11 items-center justify-center rounded-xl active:scale-95"
            aria-label={t("academyInstructorsTitle")}
          >
            <BackArrow className="h-5 w-5" />
          </button>
          <ProviderPageTitle as="p" className="flex-1 text-sm font-semibold text-muted-foreground">
            {t("academyInstructorsTitle")}
          </ProviderPageTitle>
        </header>

        <div className="space-y-6 px-5">
          {isNew ? (
            <section className={cn(LIST, "space-y-4 p-5")}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <UserPlus className="h-5 w-5" />
                </span>
                <h1 className="text-lg font-bold">
                  {t("academyInstructorNew")}
                  <BranchSuffix />
                </h1>
              </div>
              <Field label={t("academyInstructorName")} htmlFor="instructor-name" help={t("academyInstructorNewHelp")}>
                <Input
                  id="instructor-name"
                  value={newName}
                  autoFocus
                  maxLength={NAME_MAX}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create();
                  }}
                  className="h-12 rounded-xl text-base"
                />
              </Field>
              <Button
                onClick={() => void create()}
                disabled={createInstructor.isPending || !newName.trim()}
                className="h-12 w-full rounded-2xl text-base font-semibold"
              >
                {t("academyInstructorAdd")}
              </Button>
            </section>
          ) : isLoading ? (
            <>
              <div className={cn(LIST, "h-36 animate-pulse")} />
              <div className={cn(LIST, "h-32 animate-pulse")} />
            </>
          ) : !instructor ? (
            <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
              <p className="text-sm text-foreground/60">{t("academyInstructorNotFound")}</p>
              <Button variant="outline" className="mt-5 h-11 rounded-2xl px-5" onClick={() => navigate("/instructors")}>
                {t("academyInstructorsTitle")}
              </Button>
            </section>
          ) : (
            <>
              {/* Photo row: the picture and its actions. Name and status are
                  the rows below, so they are not repeated here. */}
              <section className={cn(LIST, "flex items-center gap-4 p-4")}>
                <div className="relative shrink-0">
                  <InstructorAvatar
                    id={instructor.id}
                    name={instructor.name}
                    photoUrl={instructor.photo_url}
                    size="lg"
                    muted={!instructor.is_active}
                  />
                  {photoBusy && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <PhotoButton icon={Camera} disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                    {instructor.photo_url ? t("academyInstructorPhotoChange") : t("acPhotoAdd")}
                  </PhotoButton>
                  {instructor.photo_url && (
                    <PhotoButton icon={Trash2} disabled={photoBusy} onClick={() => void removePhoto()}>
                      {t("academyInstructorPhotoRemove")}
                    </PhotoButton>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickPhoto}
                  aria-label={t("academyInstructorPhoto")}
                />
              </section>

              <SettingsGroup>
                <NavRow
                  icon={User}
                  title={t("academyInstructorName")}
                  description={<bdi>{instructor.name}</bdi>}
                  onClick={() => openSheet("name")}
                />
                <NavRow
                  icon={AlignLeft}
                  title={t("academyInstructorBio")}
                  description={bio || t("acNotWritten")}
                  muted={!bio}
                  lines={2}
                  onClick={() => openSheet("bio")}
                />
              </SettingsGroup>

              <SettingsGroup>
                <SwitchRow
                  title={t("academyInstructorActive")}
                  description={instructor.is_active ? t("academyInstructorActiveHelp") : t("academyInstructorInactiveHelp")}
                  checked={instructor.is_active}
                  onChange={(next) => (next ? void setActive(true) : setConfirmDeactivate(true))}
                  disabled={updateInstructor.isPending}
                />
              </SettingsGroup>

              <EditSheet
                open={sheet === "name"}
                onClose={closeSheet}
                icon={User}
                title={t("academyInstructorName")}
                onSave={() => void saveName()}
                saving={updateInstructor.isPending}
                saveDisabled={!nameDraft.trim()}
              >
                <Field label={t("academyInstructorName")} htmlFor="instructor-name-edit">
                  <Input
                    id="instructor-name-edit"
                    value={nameDraft}
                    maxLength={NAME_MAX}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveName();
                    }}
                    className="h-12 rounded-xl text-base"
                  />
                </Field>
              </EditSheet>

              <EditSheet
                open={sheet === "bio"}
                onClose={closeSheet}
                icon={AlignLeft}
                title={t("academyInstructorBio")}
                onSave={() => void saveBio()}
                saving={updateInstructor.isPending}
                saveDisabled={!bioDirty}
              >
                <Field label={t("academyInstructorBio")} htmlFor="instructor-bio">
                  <Textarea
                    id="instructor-bio"
                    value={bioDraft}
                    maxLength={BIO_MAX}
                    rows={6}
                    placeholder={t("academyInstructorBioPlaceholder")}
                    onChange={(e) => setBioDraft(e.target.value)}
                    className="rounded-xl text-base"
                  />
                </Field>
              </EditSheet>

              <InstructorDeactivateDialog
                open={confirmDeactivate}
                onOpenChange={setConfirmDeactivate}
                onConfirm={() => void setActive(false)}
                pending={updateInstructor.isPending}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PhotoButton({
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  icon: typeof Camera;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-white/70 px-3 text-sm font-medium transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
    >
      <Icon className="h-4 w-4 shrink-0 text-accent" />
      <span className="truncate">{children}</span>
    </button>
  );
}
