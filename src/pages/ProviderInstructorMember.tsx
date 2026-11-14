import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera, Check, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { ProviderPageTitle } from "@/components/branch/ProviderPageTitle";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import { InstructorDeactivateDialog } from "@/components/academy/InstructorDeactivateDialog";
import { academyErrorMessage } from "@/lib/academyErrors";
import { validateAcademyImage } from "@/lib/academyImage";
import { isAcademyCategory } from "@/lib/academyCategory";

const NAME_MAX = 120;
const BIO_MAX = 2000;

/**
 * /instructors/:id and /instructors/new — the academy twin of /staff/:id.
 *
 * /new is a name and a button (the photo path needs the row id first). The
 * member view has the photo (upload / replace / remove), inline rename, the
 * active switch (turning OFF is confirmed), and the bio with its own Save.
 * Every write is independent and reports its own failure.
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
  const [editingName, setEditingName] = useState(false);
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

  useEffect(() => {
    if (instructor) {
      if (!editingName) setNameDraft(instructor.name);
      setBioDraft(instructor.bio ?? "");
    }
    // Re-seed only when the row itself changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructor?.id, instructor?.name, instructor?.bio]);

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

  const commitName = async () => {
    if (!instructor) return;
    const name = nameDraft.trim();
    if (!name || name.length > NAME_MAX) {
      toast.error(t("academyErrName"));
      return;
    }
    if (name !== instructor.name) {
      try {
        await updateInstructor.mutateAsync({ id: instructor.id, patch: { name } });
        toast.success(t("academyInstructorSaved"));
      } catch (err) {
        fail(err);
        return;
      }
    }
    setEditingName(false);
  };

  const saveBio = async () => {
    if (!instructor) return;
    const bio = bioDraft.trim();
    try {
      await updateInstructor.mutateAsync({ id: instructor.id, patch: { bio: bio === "" ? null : bio } });
      toast.success(t("academyInstructorSaved"));
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
        <header className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button
            onClick={() => navigate("/instructors")}
            className="-ms-1.5 rounded-xl p-1.5 active:scale-95"
            aria-label={t("academyInstructorsTitle")}
          >
            <BackArrow className="h-5 w-5" />
          </button>
          <ProviderPageTitle as="p" className="flex-1 text-sm font-semibold text-muted-foreground">
            {t("academyInstructorsTitle")}
          </ProviderPageTitle>
        </header>

        <div className="flex flex-col gap-3.5 px-5">
          {isNew ? (
            <section className="glass-card rounded-3xl p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <UserPlus className="h-5 w-5" />
                </span>
                <h1 className="text-lg font-bold">
                  {t("academyInstructorNew")}
                  <BranchSuffix />
                </h1>
              </div>
              <Label htmlFor="instructor-name">{t("academyInstructorName")}</Label>
              <Input
                id="instructor-name"
                value={newName}
                autoFocus
                maxLength={NAME_MAX}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                className="mt-1.5 h-12 text-base"
              />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("academyInstructorNewHelp")}</p>
              <Button
                onClick={() => void create()}
                disabled={createInstructor.isPending || !newName.trim()}
                className="mt-4 h-12 w-full text-base font-semibold"
              >
                {t("academyInstructorAdd")}
              </Button>
            </section>
          ) : isLoading ? (
            <>
              <div className="h-40 rounded-3xl bg-secondary animate-pulse" />
              <div className="h-40 rounded-3xl bg-secondary animate-pulse" />
            </>
          ) : !instructor ? (
            <div className="glass-card rounded-2xl p-6 text-center">
              <p className="text-sm text-muted-foreground">{t("academyInstructorNotFound")}</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate("/instructors")}>
                {t("academyInstructorsTitle")}
              </Button>
            </div>
          ) : (
            <>
              <section className="glass-card rounded-3xl p-5">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <InstructorAvatar
                      id={instructor.id}
                      name={instructor.name}
                      photoUrl={instructor.photo_url}
                      size="lg"
                      muted={!instructor.is_active}
                      className="ring-2 ring-accent/30 ring-offset-2 ring-offset-white/40"
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={photoBusy}
                      aria-label={t("academyInstructorPhotoChange")}
                      className="absolute -bottom-1 -end-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground shadow active:scale-95 disabled:opacity-50"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {editingName ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={nameDraft}
                          autoFocus
                          maxLength={NAME_MAX}
                          aria-label={t("academyInstructorName")}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitName();
                            if (e.key === "Escape") setEditingName(false);
                          }}
                          className="h-11 text-base font-semibold"
                        />
                        <button
                          type="button"
                          onClick={() => void commitName()}
                          disabled={updateInstructor.isPending}
                          aria-label={t("save")}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground active:scale-95 disabled:opacity-50"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNameDraft(instructor.name);
                            setEditingName(false);
                          }}
                          aria-label={t("cancel")}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground active:scale-95"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h1
                          className={`truncate text-xl font-bold ${instructor.is_active ? "" : "text-muted-foreground line-through"}`}
                        >
                          {instructor.name}
                        </h1>
                        <button
                          type="button"
                          onClick={() => setEditingName(true)}
                          aria-label={t("academyInstructorRename")}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {instructor.photo_url && (
                      <button
                        type="button"
                        onClick={() => void removePhoto()}
                        disabled={photoBusy}
                        className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("academyInstructorPhotoRemove")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3.5">
                  <Switch
                    checked={instructor.is_active}
                    onCheckedChange={(next) => (next ? void setActive(true) : setConfirmDeactivate(true))}
                    disabled={updateInstructor.isPending}
                    aria-label={t("academyInstructorActive")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {instructor.is_active ? t("academyInstructorActive") : t("academyInstructorInactive")}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {instructor.is_active ? t("academyInstructorActiveHelp") : t("academyInstructorInactiveHelp")}
                    </p>
                  </div>
                </div>
              </section>

              <section className="glass-card rounded-3xl p-5">
                <Label htmlFor="instructor-bio">{t("academyInstructorBio")}</Label>
                <Textarea
                  id="instructor-bio"
                  value={bioDraft}
                  maxLength={BIO_MAX}
                  rows={5}
                  placeholder={t("academyInstructorBioPlaceholder")}
                  onChange={(e) => setBioDraft(e.target.value)}
                  className="mt-1.5"
                />
                <Button
                  onClick={() => void saveBio()}
                  disabled={!bioDirty || updateInstructor.isPending}
                  className="mt-3 w-full"
                >
                  {t("save")}
                </Button>
              </section>

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
