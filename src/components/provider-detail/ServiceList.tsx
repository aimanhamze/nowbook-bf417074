import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { sized, withOriginalFallback } from "@/lib/imageUrl";
import { visibleServiceCount } from "@/lib/serviceListCollapse";
import type { Service } from "@/lib/mock-data";
import type { Lang } from "@/lib/translations";

// 44px box. Width-only (resize=contain), sized so a 16:9 source still covers
// the box at DPR 3 in both dimensions: max(3 × 44, 5.33 × 44) = 235 ≤ 240.
const THUMB_REQUEST = { width: 240 } as const;

interface Props {
  services: Service[];
  showPrices: boolean;
  lang: Lang;
  t: (key: string) => string;
  /**
   * Given: every row is a button that starts booking with that service, and
   * shows a chevron. Omitted: plain rows (a fitness studio books classes, and
   * a page without the Book button has nothing to start).
   */
  onSelect?: (service: Service) => void;
}

/**
 * The provider's services as one price list: a single soft card, light hairlines
 * between rows, name at the start and price at the end in tabular figures.
 * Long lists show the first few and expand in place.
 */
export function ServiceList({ services, showPrices, lang, t, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = services.slice(0, visibleServiceCount(services.length, expanded));
  const collapsible = visibleServiceCount(services.length, false) < services.length;
  // The thumbnail column exists only when some service has a picture; a list
  // with none is plain text rather than a column of placeholder icons.
  const hasThumbs = services.some((s) => !!s.image_url);
  // Points forward: toward the end side (left in Hebrew and Arabic).
  const Forward = lang === "en" ? ChevronRight : ChevronLeft;

  const rowContent = (service: Service) => (
    <>
      {hasThumbs && (
        <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-accent/10">
          {service.image_url && (
            <img
              src={sized(service.image_url, THUMB_REQUEST)}
              alt=""
              loading="lazy"
              decoding="async"
              width={44}
              height={44}
              className="h-full w-full object-cover"
              onError={withOriginalFallback(service.image_url)}
            />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1 text-start">
        {/* <bdi> orders a mixed Hebrew/Arabic/English name by its own
            first strong letter, while the line stays aligned to the
            page's start side. */}
        <span className="line-clamp-2 text-[15px] font-medium leading-snug text-foreground">
          <bdi>{service.name[lang]}</bdi>
        </span>
        <span className="mt-0.5 block text-[13px] text-foreground/70">
          {service.duration} {t("min")}
        </span>
      </span>
      {showPrices && service.price > 0 && (
        // Left-to-right island: the ₪ sign leads the number in every language.
        <span dir="ltr" className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
          ₪{service.price.toLocaleString("en-US")}
        </span>
      )}
      {onSelect && <Forward aria-hidden className="h-4 w-4 shrink-0 text-foreground/50" />}
    </>
  );
  const rowClass = "flex min-h-16 w-full items-center gap-3.5 px-4 py-3.5";

  return (
    <div className="surface-soft overflow-hidden rounded-2xl">
      <ul className="divide-y divide-border/40">
        {shown.map((service) => (
          <li key={service.id}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(service)}
                className={`${rowClass} text-start transition-colors active:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
              >
                {rowContent(service)}
              </button>
            ) : (
              <div className={rowClass}>{rowContent(service)}</div>
            )}
          </li>
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-border/40 px-4 text-sm font-semibold text-accent transition-colors active:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {expanded ? t("showLess") : t("showAllServices").replace("{n}", String(services.length))}
          <ChevronDown aria-hidden className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
