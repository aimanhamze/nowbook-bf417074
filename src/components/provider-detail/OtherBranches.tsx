import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAllProviders } from "@/hooks/useAllProviders";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { branchCityLabel, siblingBranches } from "@/lib/otherBranches";
import type { Provider } from "@/lib/mock-data";

/**
 * "Other branches" on the provider page — one compact row per sibling branch
 * of the same owner, so a customer who landed on the wrong city switches in
 * one tap. Automatic for every owner with 2+ visible branches; renders
 * nothing for a single-branch owner (almost everyone).
 *
 * No extra request: reads the cached ["all-providers"] list the page itself
 * resolves from, so visibility is exactly the page's (is_visible only).
 */
export function OtherBranches({ provider }: { provider: Provider }) {
  const { lang, t } = useLang();
  const { providers } = useAllProviders();
  const siblings = siblingBranches(providers, provider, lang);
  if (siblings.length === 0) return null;

  return (
    <section className="mt-6 px-5" aria-labelledby="other-branches-title">
      <SectionLabel className="mb-2.5">
        <span id="other-branches-title">{t("otherBranches")}</span>
      </SectionLabel>
      <ul className="glass-card-md divide-y divide-border/60 overflow-hidden rounded-2xl">
        {siblings.map((b) => {
          const name = b.name[lang];
          const city = branchCityLabel(name, b.address[lang]);
          return (
            <li key={b.id}>
              <Link
                to={`/provider/${b.id}`}
                // The page remounts per id (keyed in ProviderDetail); start the
                // new branch at the top, not at this section's scroll offset.
                // "instant" overrides html's scroll-behavior: smooth, which
                // would otherwise animate the jump over the new page.
                onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
                className="flex min-h-12 items-center gap-3 px-3.5 py-2 text-start transition-colors active:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <MapPin className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                {/* dir="auto" per run: a Latin name on an RTL page (or an
                    Arabic one on LTR) truncates at its own end, not its
                    start. The dot sits outside both runs so it follows the
                    row's direction. */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span dir="auto" className="truncate text-sm font-semibold">{name}</span>
                  {city && (
                    <>
                      <span aria-hidden className="shrink-0 text-xs text-muted-foreground">·</span>
                      <span dir="auto" className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{city}</span>
                    </>
                  )}
                </span>
                <ForwardArrow className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
