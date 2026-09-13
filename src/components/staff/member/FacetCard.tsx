import type { LucideIcon } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";

export type FacetState = "follows" | "custom" | "warn";

interface Props {
  icon: LucideIcon;
  title: string;
  state: FacetState;
  /** One line of current state, in words. */
  summary: string;
  /** Service names, wrapping. Only when configured. */
  chips?: string[];
  /** Seven cells for a configured week: weekday letter + on/off. */
  mini?: { label: string; on: boolean }[];
  /** Time range shown inside the mini strip's caption, LTR-isolated. */
  miniRange?: string | null;
  onClick: () => void;
}

/**
 * One facet of a member — services, hours, or days off — as a STATUS, not a
 * form field. Three visual states carry the meaning:
 *
 *   follows → muted. The zero-rows default; the healthy, common case.
 *   custom  → accent-tinted, with a concrete summary.
 *   warn    → amber. Zero of N services, or a week with no working day: the
 *             member can never be booked, and the card says so in words.
 *
 * Tapping anywhere opens that facet's sheet. Tier-2 surface, like the roster
 * rows; the page already carries the header's Tier-1 glass.
 */
export function FacetCard({ icon: Icon, title, state, summary, chips, mini, miniRange, onClick }: Props) {
  const { t } = useLang();

  const stateLabel =
    state === "follows" ? t("staffStateFollows") : state === "custom" ? t("staffStateCustom") : t("staffStateWarn");

  return (
    <button
      type="button"
      onClick={onClick}
      className="surface-soft flex w-full items-start gap-3 rounded-2xl p-3.5 text-start transition-transform active:scale-[0.99]"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]",
          state === "follows" && "bg-secondary text-muted-foreground",
          state === "custom" && "bg-accent/[0.12] text-accent",
          state === "warn" && "bg-amber-100 text-amber-800",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold">{title}</span>
          <span
            className={cn(
              "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
              state === "follows" && "bg-secondary text-muted-foreground",
              state === "custom" && "bg-accent/[0.12] text-accent",
              state === "warn" && "bg-amber-100 text-amber-800",
            )}
          >
            {stateLabel}
          </span>
        </span>

        <span className={cn("text-[13px] leading-snug", state === "warn" ? "font-medium text-amber-800" : "text-muted-foreground")}>
          {summary}
        </span>

        {chips && chips.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium">
                {c}
              </span>
            ))}
          </span>
        )}

        {mini && mini.length > 0 && (
          <span className="flex flex-col gap-1.5">
            <span className="flex gap-1" aria-hidden>
              {mini.map((d, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex h-[22px] flex-1 items-center justify-center rounded-md text-[10px] font-semibold",
                    d.on ? "bg-accent/[0.14] text-accent" : "bg-secondary text-muted-foreground/60",
                  )}
                >
                  {d.label}
                </span>
              ))}
            </span>
            {miniRange && (
              <span className="text-xs text-muted-foreground">
                <bdi>{miniRange}</bdi>
              </span>
            )}
          </span>
        )}
      </span>

      <ForwardArrow className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
