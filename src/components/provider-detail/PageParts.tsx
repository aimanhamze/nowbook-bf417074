import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/SectionLabel";
import type { Review } from "@/hooks/useReviews";

// Small pieces that belong to the customer provider page only. The shared
// SectionLabel and ReviewCard stay as they are for the rest of the app.

/**
 * The page's section heading: the shared SectionLabel (orange bar), read at
 * this page's sizes — 13px, text-foreground/70, and no letter-spacing in
 * Hebrew and Arabic (it breaks Arabic joins and loosens Hebrew).
 */
export function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SectionLabel className={cn("text-[13px] text-foreground/70 rtl:tracking-normal", className)}>
      {children}
    </SectionLabel>
  );
}

/**
 * The provider's description (the page wraps it in a soft card): three lines, and a
 * "read more" link only when the text is actually cut. dir="auto" lets an
 * English description on a Hebrew page read (and align) its own way.
 */
export function AboutText({ text, moreLabel, lessLabel }: { text: string; moreLabel: string; lessLabel: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // Measured while collapsed: is there more text than the three lines show?
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, expanded]);

  return (
    <>
      <p
        ref={ref}
        dir="auto"
        className={`whitespace-pre-line text-start text-[15px] leading-relaxed text-foreground/85 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="-mb-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-accent"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </>
  );
}

/** One review as a row of the reviews card; the list supplies the hairlines. */
export function ReviewRow({ review, anonymousLabel }: { review: Review; anonymousLabel: string }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">
          <bdi>{review.display_name || anonymousLabel}</bdi>
        </span>
        <span dir="ltr" className="shrink-0 text-[13px] tabular-nums text-foreground/70">
          {format(new Date(review.created_at), "dd/MM/yyyy")}
        </span>
      </div>
      <div role="img" aria-label={`${review.rating}/5`} className="mt-1 flex gap-0.5">
        {Array.from({ length: 5 }).map((_, s) => (
          <Star
            key={s}
            aria-hidden
            className={`h-3.5 w-3.5 ${s < review.rating ? "fill-accent text-accent" : "text-foreground/20"}`}
          />
        ))}
      </div>
      {review.comment && (
        <p dir="auto" className="mt-1.5 whitespace-pre-line text-start text-[15px] leading-normal text-foreground">
          {review.comment}
        </p>
      )}
    </li>
  );
}
