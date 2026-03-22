import { useState } from "react";
import { Plus, Pencil, Trash2, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/contexts/LangContext";
import { useProviderServices } from "@/hooks/useProviderServices";
import { toast } from "sonner";

export function ServicesTab() {
  const { t } = useLang();
  const { services, isLoading, upsertService, deleteService } = useProviderServices();
  const [editing, setEditing] = useState<{ id?: string; name: string; duration: number; price: number } | null>(null);

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    try {
      await upsertService.mutateAsync(editing);
      toast.success(t("serviceSaved"));
      setEditing(null);
    } catch {
      toast.error("Error saving service");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteService.mutateAsync(id);
      toast.success(t("serviceDeleted"));
    } catch {
      toast.error("Error deleting service");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("manageServices")}</h2>
        <Button size="sm" onClick={() => setEditing({ name: "", duration: 30, price: 0 })} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("addService")}
        </Button>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl border border-border bg-card p-4 space-y-3"
          >
            <div>
              <Label>{t("serviceName")}</Label>
              <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("duration")} ({t("min")})</Label>
                <Input type="number" value={editing.duration} onChange={e => setEditing({ ...editing, duration: Number(e.target.value) })} onFocus={e => e.target.select()} />
              </div>
              <div>
                <Label>{t("price")} (₪)</Label>
                <Input type="number" value={editing.price} onChange={e => setEditing({ ...editing, price: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={upsertService.isPending}>{t("save")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("cancel")}</Button>
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
          {services.map((svc, i) => (
            <motion.div
              key={svc.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium text-sm">{svc.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {svc.duration} {t("min")} · ₪{svc.price}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing({ id: svc.id, name: svc.name, duration: svc.duration, price: svc.price })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(svc.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
