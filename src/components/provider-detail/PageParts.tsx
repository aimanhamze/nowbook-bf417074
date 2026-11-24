import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Review } from "@/hooks/useReviews";

// Small pieces that belong to the customer provider page only. The shared
// SectionLabel and ReviewCard stay as they are for the rest of the app.

/** The page's section heading: 18px/600, plain, no accent bar. */
export function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-start text-lg font-semibold leading-snug tracking-normal text-foreground", className)}>
      {children}
    </h2>
  );
}

/**
 * The provider's description: plain text on the page, three lines, and a
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
        className={`whitespace-pre-line text-start text-[15px] leading-normal text-foreground ${
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
          className="-mb-2 inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </>
  );
}

/** One review as a plain row; the list supplies the hairlines. */
export function ReviewRow({ review, anonymousLabel }: { review: Review; anonymousLabel: string }) {
  return (
    <li className="py-3.5">
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
