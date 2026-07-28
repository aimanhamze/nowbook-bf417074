import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

/**
 * The settings hub's one repeating unit.
 *
 * Every section on /settings is the same shape — an accent icon chip, a title,
 * an optional one-line description, an optional trailing action — so the page
 * reads as one list of things you can change rather than three unrelated
 * panels. The card shell (rounded-2xl / border-border / bg-card) is the app's
 * existing surface; only the header row is new, and it is shared so the
 * sections cannot drift apart.
 *
 * Layout is written with logical properties (gap, text-start, ms/me) so he/ar
 * RTL and en LTR render from the same markup.
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
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="rounded-2xl border border-border bg-card p-4"
    >
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 text-start">
          <h2 className="text-sm font-semibold leading-snug">{title}</h2>
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
