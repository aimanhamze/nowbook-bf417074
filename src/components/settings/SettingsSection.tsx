import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The settings hub's one repeating unit.
 *
 * Every section on /settings is the same shape — an accent icon chip, a title,
 * an optional one-line description, an optional trailing action — so the page
 * reads as one list of things you can change rather than three unrelated
 * panels.
 *
 * Surface is Tier-1 `.glass-card-md` (see index.css): /settings renders three
 * of them, well inside the documented "< 10 per page, never nest" budget, and
 * the translucency is what makes the card sit ON the warm provider gradient
 * instead of punching a flat white hole through it. Repeated rows INSIDE a
 * section use Tier-2 `.surface-soft` — no backdrop-filter, cheap at any count.
 *
 * The chip (h-9 w-9 rounded-xl bg-accent/10, 18px glyph) and the entrance
 * easing are lifted from the Profile page's menu rows, since /settings is
 * reached from there and should read as the same room.
 *
 * Layout uses logical properties (gap, text-start) so he/ar RTL and en LTR
 * render from the same markup.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  action,
  delay = 0,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Rendered at the end of the header row (e.g. an "add" button). */
  action?: ReactNode;
  /** Stagger for the page-load sequence, in seconds. */
  delay?: number;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card-md rounded-2xl p-4"
    >
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 text-start">
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      <div className="mt-4 space-y-4">{children}</div>
    </motion.section>
  );
}
