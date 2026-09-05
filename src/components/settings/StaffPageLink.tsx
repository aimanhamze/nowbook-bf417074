import { UsersRound } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { useProviderStaff } from "@/hooks/useProviderStaff";

/**
 * Navigation row from the settings hub to the Staff page (/staff).
 *
 * Same chip/title/description anatomy as SettingsSection so it reads as one of
 * the list, but the whole card is a link rather than a container. It replaced
 * the inline staff section that used to live here once /staff shipped.
 */
export function StaffPageLink({ delay = 0 }: { delay?: number }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { staff } = useProviderStaff();

  return (
    <motion.button
      type="button"
      onClick={() => navigate("/staff")}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card-md flex w-full items-center gap-3 rounded-2xl p-4 text-start transition-transform active:scale-[0.99]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <UsersRound className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{t("staffPageTitle")}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t("staffPageDesc")}</span>
      </span>
      {staff.length > 0 && (
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
          <bdi>{staff.length}</bdi>
        </span>
      )}
      <ForwardArrow className="h-4 w-4 shrink-0 text-muted-foreground" />
    </motion.button>
  );
}
