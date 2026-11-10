import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAllProviders } from "@/hooks/useAllProviders";
import { branchPillLabels, ownerBranches } from "@/lib/otherBranches";
import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/mock-data";

/**
 * Branch switcher inside the provider info card, under the location line: a
 * recessed pill track listing ALL the owner's visible branches, the open one
 * selected (accent fill, not a link), the rest tappable. Labels are cities.
 * Automatic for owners with 2+ visible branches; renders nothing otherwise.
 *
 * No extra request: reads the cached ["all-providers"] list the page itself
 * resolves from, so visibility is exactly the page's (is_visible only).
 *
 * Geometry: pills are 36px inside a 4px-padded track (44px). Each link's hit
 * area extends 4px above and below, so the whole 44px track height is
 * tappable while the control stays visually compact.
 */
export function OtherBranches({ provider }: { provider: Provider }) {
  const { lang, t, isRtl } = useLang();
  const { providers } = useAllProviders();
  const branches = ownerBranches(providers, provider, lang);
  const trackRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLSpanElement>(null);
  // Which inline edges have hidden pills past them — drives the edge fades.
  const [fade, setFade] = useState({ start: false, end: false });

  const updateFade = () => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // RTL scrollLeft runs 0 → -max in current engines; abs() normalises it.
    const pos = Math.abs(el.scrollLeft);
    setFade({ start: max > 1 && pos > 1, end: max > 1 && pos < max - 1 });
  };

  // Centre the selected pill once on mount (the page remounts per branch).
  // Delta of centres works in both directions, so RTL needs no special case.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const sel = selectedRef.current;
    if (!track || !sel) return;
    const tr = track.getBoundingClientRect();
    const sr = sel.getBoundingClientRect();
    track.scrollLeft += sr.left + sr.width / 2 - (tr.left + tr.width / 2);
    updateFade();
  }, [branches.length]);

  if (branches.length === 0) return null;
  const labels = branchPillLabels(branches, lang);

  const fadeMask =
    fade.start || fade.end
      ? `linear-gradient(to ${isRtl ? "left" : "right"}, ${fade.start ? "transparent, #000 1.5rem" : "#000"}, ${fade.end ? "#000 calc(100% - 1.5rem), transparent" : "#000"})`
      : undefined;

  const pill = "flex h-9 max-w-[9.5rem] shrink-0 items-center rounded-full px-3.5 text-xs";

  return (
    <nav aria-label={t("branchesLabel")} className="mt-4 flex justify-center">
      <div
        ref={trackRef}
        onScroll={updateFade}
        style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
        className="flex max-w-full gap-1 overflow-x-auto overscroll-x-contain rounded-full bg-foreground/[0.05] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {branches.map((b) => {
          const label = labels.get(b.id)!;
          return b.id === provider.id ? (
            <span
              key={b.id}
              ref={selectedRef}
              aria-current="page"
              className={cn(pill, "bg-accent font-semibold text-accent-foreground shadow-[0_2px_8px_hsl(var(--accent)/0.35)]")}
            >
              <span dir="auto" className="truncate">{label}</span>
            </span>
          ) : (
            <Link
              key={b.id}
              to={`/provider/${b.id}`}
              // The page remounts per id (keyed in ProviderDetail); start the
              // new branch at the top, not at this card's scroll offset.
              // "instant" overrides html's scroll-behavior: smooth, which
              // would otherwise animate the jump over the new page.
              onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
              className={cn(
                pill,
                "relative font-medium text-muted-foreground transition-colors after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              )}
            >
              <span dir="auto" className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
