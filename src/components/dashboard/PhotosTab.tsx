import { useRef, useState } from "react";
import { ImageIcon, ImagePlus, Images, Loader2, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { BackArrow, ForwardArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { useProviderPhotos } from "@/hooks/useProviderPhotos";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DangerRow, EditSheet, Field, SettingsGroup } from "./SettingsRows";
import { GROUP_HEADING, LIST, ROW } from "./settingsList";

// Touch-first: every action is a tap on a visible control (the old grid hid
// delete and reorder behind :hover, which a phone never has). Tapping a photo
// opens its sheet; moving and deleting use the same mutations as before
// (reorderPhotos rewrites sort_order 0..n-1, deletePhoto removes the row), and
// uploads insert into the active branch's provider_photos.
export function PhotosTab() {
  const { t } = useLang();
  const { photos, isLoading, uploadPhoto, deletePhoto, reorderPhotos, maxPhotos } = useProviderPhotos();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const atMax = photos.length >= maxPhotos;
  const index = selectedId ? photos.findIndex((p) => p.id === selectedId) : -1;
  const selected = index >= 0 ? photos[index] : null;

  const openAdd = () => {
    if (atMax) {
      toast.error(t("maxPhotos"));
      return;
    }
    setCaption("");
    setAdding(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= maxPhotos) {
      toast.error(t("maxPhotos"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      await uploadPhoto.mutateAsync({ file, caption });
      setCaption("");
      setAdding(false);
      toast.success(t("phAdded"));
    } catch (err) {
      toast.error(err instanceof Error && err.message === "MAX_PHOTOS" ? t("maxPhotos") : t("coverImageUploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const move = async (direction: -1 | 1) => {
    if (index < 0 || reorderPhotos.isPending) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= photos.length) return;
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(newIndex, 0, moved);
    try {
      await reorderPhotos.mutateAsync(ids);
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const handleDelete = async () => {
    if (!selected || deletePhoto.isPending) return;
    try {
      await deletePhoto.mutateAsync(selected.id);
      setConfirmDelete(false);
      setSelectedId(null);
      toast.success(t("phDeleted"));
    } catch {
      setConfirmDelete(false);
      toast.error(t("svDeleteError"));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-6">
      <h2 className="text-lg font-semibold">{t("photos")}</h2>

      {isLoading ? (
        <div className={cn(LIST, "grid grid-cols-3 gap-2 p-2")}>
          {[1, 2, 3].map((i) => <div key={i} className="aspect-square animate-pulse rounded-2xl bg-foreground/[0.05]" />)}
        </div>
      ) : photos.length === 0 ? (
        <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Images className="h-6 w-6" />
          </span>
          <p className="mt-3 font-semibold">{t("noPhotos")}</p>
          <p className="mt-1 text-sm text-foreground/60">{t("phEmptyBody")}</p>
          <Button onClick={openAdd} className="mt-5 h-11 gap-1.5 rounded-2xl px-5">
            <Plus className="h-4 w-4" />
            {t("phAddTitle")}
          </Button>
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <h3 className={GROUP_HEADING}>
              {t("phCount").replace("{n}", String(photos.length)).replace("{max}", String(maxPhotos))}
            </h3>
            {atMax && <p className="text-xs font-medium text-amber-700">{t("maxPhotos")}</p>}
          </div>
          <div className={cn(LIST, "grid grid-cols-3 gap-2 p-2 sm:grid-cols-4")}>
            {!atMax && (
              <button
                type="button"
                onClick={openAdd}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-accent/35 text-accent transition-colors active:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ImagePlus className="h-6 w-6" />
                <span className="px-1 text-xs font-semibold">{t("phAddTitle")}</span>
              </button>
            )}
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setSelectedId(photo.id)}
                aria-haspopup="dialog"
                aria-label={`${t("phPosition").replace("{n}", String(i + 1)).replace("{total}", String(photos.length))}${photo.caption ? ` · ${photo.caption}` : ""}`}
                className="relative aspect-square overflow-hidden rounded-2xl bg-foreground/[0.05] transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <img src={photo.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                {i === 0 && (
                  <span className="absolute start-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">1</span>
                )}
              </button>
            ))}
          </div>
          <p className="px-1 text-xs leading-snug text-foreground/60">{t("phHint")}</p>
        </section>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label={t("phChoose")}
      />

      {/* ── Add: optional caption, then pick the file (it uploads at once) ── */}
      <EditSheet
        open={adding}
        onClose={() => setAdding(false)}
        icon={ImagePlus}
        title={t("phAddTitle")}
        saving={uploading}
        footer={
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-12 w-full gap-2 rounded-2xl text-base font-semibold"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {uploading ? t("uploadProgress") : t("phChoose")}
          </Button>
        }
      >
        <Field label={t("photoCaption")} htmlFor="ph-caption" help={t("phCaptionHelp")}>
          <Input id="ph-caption" value={caption} maxLength={120} disabled={uploading}
            onChange={(e) => setCaption(e.target.value)} className="h-12 rounded-xl" />
        </Field>
      </EditSheet>

      {/* ── One photo: preview, move, delete ─────────────────────────────── */}
      <EditSheet
        open={!!selected}
        onClose={() => setSelectedId(null)}
        icon={Images}
        title={selected ? t("phPosition").replace("{n}", String(index + 1)).replace("{total}", String(photos.length)) : t("photos")}
      >
        {selected && (
          <>
            <div className="overflow-hidden rounded-2xl bg-foreground/[0.05]">
              <img src={selected.url} alt="" className="mx-auto max-h-[38vh] w-full object-contain" />
            </div>
            {selected.caption && <p className="text-center text-sm text-foreground/70">{selected.caption}</p>}
            <SettingsGroup plain>
              <button type="button" onClick={() => void move(-1)} disabled={index === 0 || reorderPhotos.isPending}
                className={cn(ROW, "disabled:opacity-40")}>
                <BackArrow className="h-[18px] w-[18px] shrink-0 text-accent" />
                <span className="flex-1 text-sm font-semibold">{t("phMoveEarlier")}</span>
                {reorderPhotos.isPending && <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />}
              </button>
              <button type="button" onClick={() => void move(1)} disabled={index === photos.length - 1 || reorderPhotos.isPending}
                className={cn(ROW, "disabled:opacity-40")}>
                <ForwardArrow className="h-[18px] w-[18px] shrink-0 text-accent" />
                <span className="flex-1 text-sm font-semibold">{t("phMoveLater")}</span>
              </button>
            </SettingsGroup>
            <SettingsGroup plain>
              <DangerRow icon={Trash2} label={t("deletePhoto")} onClick={() => setConfirmDelete(true)} />
            </SettingsGroup>
          </>
        )}
      </EditSheet>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!o && !deletePhoto.isPending) setConfirmDelete(false); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("phDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("phDeleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700"
              disabled={deletePhoto.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {t("deletePhoto")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
