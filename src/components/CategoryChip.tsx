import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface CategoryChipProps {
  icon: LucideIcon;
  label: string;
  /** Filter pages (Explore): the active chip gets the filled-accent style. */
  selected?: boolean;
  onClick: () => void;
}

/**
 * Shared category chip — Home (navigation row) and Explore (filter row) render
 * the exact same chip; Explore additionally passes `selected`. Unselected look
 * is the original Home chip pixel-for-pixel; selected is the filled brand
 * accent with the soft accent glow the design language uses for active pills.
 */
export function CategoryChip({ icon: Icon, label, selected = false, onClick }: CategoryChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] shrink-0 snap-start items-center gap-2 rounded-full py-1.5 ps-1.5 pe-3.5 transition-[background-color,transform] active:scale-95",
        selected
          ? "bg-accent shadow-[0_6px_16px_-6px_hsl(24_80%_55%/0.6)]"
          : "surface-soft hover:bg-accent/[0.08]"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          selected ? "bg-white/20" : "bg-accent/10"
        )}
      >
        <Icon className={cn("h-4 w-4", selected ? "text-accent-foreground" : "text-accent")} />
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-xs font-semibold",
          selected ? "text-accent-foreground" : "text-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );
}
