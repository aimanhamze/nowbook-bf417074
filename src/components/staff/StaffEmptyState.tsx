import { Plus, Users } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";

/**
 * No staff yet: one hero block, one sentence on what staff mode gives customers,
 * one primary action. The customer-facing switch is not shown here at all — it
 * cannot be turned on without an active member, so showing it disabled would
 * only be a second thing to explain.
 */
export function StaffEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useLang();
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card rounded-3xl px-6 py-8 text-center"
    >
      <span className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-accent/10 text-accent">
        <Users className="h-11 w-11" strokeWidth={1.5} />
      </span>
      <h2 className="mb-2 text-xl font-bold">{t("staffEmptyTitle")}</h2>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t("staffEmptyBody")}</p>
      <Button onClick={onAdd} className="h-12 w-full gap-2 text-base">
        <Plus className="h-5 w-5" />
        {t("staffEmptyCta")}
      </Button>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("staffEmptyNote")}</p>
    </motion.section>
  );
}
