import { useRef, useState } from "react";
import { Trash2, Upload, ChevronUp, ChevronDown, ImageIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { useProviderPhotos } from "@/hooks/useProviderPhotos";
import { toast } from "sonner";

export function PhotosTab() {
  const { t } = useLang();
  const { photos, isLoading, uploadPhoto, deletePhoto, reorderPhotos, maxPhotos } = useProviderPhotos();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= maxPhotos) {
      toast.error(t("maxPhotos"));
      return;
    }
    setUploading(true);
    try {
      await uploadPhoto.mutateAsync({ file, caption });
      setCaption("");
      toast.success(t("addPhoto"));
    } catch (err: any) {
      if (err?.message === "MAX_PHOTOS") {
        toast.error(t("maxPhotos"));
      } else {
        toast.error(t("coverImageUploadError"));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePhoto.mutateAsync(id);
      setConfirmDeleteId(null);
    } catch {
      toast.error(t("coverImageUploadError"));
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= photos.length) return;
    const ids = photos.map(p => p.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(newIndex, 0, moved);
    try {
      await reorderPhotos.mutateAsync(ids);
    } catch {
      toast.error(t("coverImageUploadError"));
    }
  };

  const atMax = photos.length >= maxPhotos;

  return (
    <div className="pb-8">
      {/* Header + count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {photos.length}/{maxPhotos} {t("photos")}
        </p>
      </div>

      {/* Upload area */}
      {!atMax && (
        <div className="mb-6 p-4 rounded-2xl border border-dashed border-border bg-secondary/30 space-y-3">
          <Input
            placeholder={t("photoCaption")}
            value={caption}
            onChange={e => setCaption(e.target.value)}
            disabled={uploading}
            maxLength={120}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full gap-2"
            variant="outline"
          >
            {uploading ? (
              <>
                <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                {t("uploadProgress")}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {t("addPhoto")} +
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {atMax && (
        <p className="text-xs text-amber-500 mb-4">{t("maxPhotos")}</p>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && photos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <ImageIcon className="h-10 w-10 opacity-30" />
          <p className="text-sm">{t("noPhotos")}</p>
        </div>
      )}

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <AnimatePresence>
            {photos.map((photo, i) => (
              <motion.div
                key={photo.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="relative group rounded-xl overflow-hidden bg-secondary aspect-square"
              >
                <img
                  src={photo.url}
                  alt={photo.caption ?? ""}
                  className="w-full h-full object-cover"
                />
                {photo.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-1">
                    <p className="text-white text-[10px] truncate">{photo.caption}</p>
                  </div>
                )}

                {/* Reorder buttons */}
                <div className="absolute top-1 left-1 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || reorderPhotos.isPending}
                    className="p-0.5 rounded bg-black/60 text-white disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === photos.length - 1 || reorderPhotos.isPending}
                    className="p-0.5 rounded bg-black/60 text-white disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>

                {/* Delete button */}
                {confirmDeleteId === photo.id ? (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1 p-2">
                    <p className="text-white text-[10px] text-center">{t("deleteConfirm")}</p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(photo.id)}
                        className="px-2 py-0.5 rounded bg-destructive text-white text-[10px]"
                      >
                        {t("deletePhoto")}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-0.5 rounded bg-secondary text-foreground text-[10px]"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(photo.id)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={t("deletePhoto")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
