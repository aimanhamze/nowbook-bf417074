import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import { useProviderCustomers, type ProviderCustomer } from "@/hooks/useProviderCustomers";
import { rankCustomers } from "@/lib/customerSearch";

interface Props {
  name: string;
  phone: string;
  /** What was typed in the search when step 4 was last left for the
   *  new-customer view, so Back from there returns to the same search. */
  initialQuery?: string;
  /** A complete past customer was tapped: fill name + phone. */
  onPick: (name: string, phone: string) => void;
  /** "Change" on the card: clear name + phone, back to the search. */
  onClear: () => void;
  /** "+ New customer": open the new-customer view with what was typed. */
  onNew: (query: string) => void;
  /** The card was tapped: edit the picked name + phone. */
  onEdit: () => void;
  /** A past customer missing a name or phone: complete it first. */
  onIncomplete: (name: string, phone: string, query: string) => void;
}

/**
 * Step 4's customer: a search over the provider's OWN past customers (the same
 * useProviderCustomers data the old autocomplete used) — nothing listed until
 * something is typed — a "+ New customer" button under it, or the compact
 * card once a customer is set. New customers and edits happen in the sheet's dedicated
 * new-customer view, not here.
 *
 * Picking only fills the name and phone text, exactly as before: it never
 * links the booking to an account (walk-ins stay user_id NULL; the phone is
 * stored as given and link_walkin_to_account matches it server-side).
 */
export function CustomerPicker({ name, phone, initialQuery = "", onPick, onClear, onNew, onEdit, onIncomplete }: Props) {
  const { t } = useLang();
  const { data: customers = [], isLoading } = useProviderCustomers();
  const [query, setQuery] = useState(initialQuery);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const picked = !!name.trim() && !!phone.trim();

  // Back from the new-customer view lands on the search with the query kept;
  // put the caret back in it only if there was one (the provider was typing).
  useEffect(() => {
    if (initialQuery && !picked) searchRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing is listed until something is typed; then the best five.
  const results = useMemo(() => rankCustomers(customers, query), [customers, query]);

  // The booking summary sits above the search, so once the keyboard has
  // settled bring the search to the top of the step's scroller: its results
  // then get the strip above the keyboard.
  const focusTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const onSearchFocus = () => {
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (document.activeElement === searchRef.current) {
        searchBoxRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 350);
  };

  const pick = (c: ProviderCustomer) => {
    // Same fill as the old autocomplete's pick.
    const pickedName = c.name?.trim() || "";
    const pickedPhone = c.phone?.trim() || "";
    searchRef.current?.blur();
    // Missing half a record (a phone-only walk-in, say): complete it in the
    // new-customer view, instead of a card Create would reject.
    if (pickedName && pickedPhone) onPick(pickedName, pickedPhone);
    else onIncomplete(pickedName, pickedPhone, query.trim());
  };

  // Rows keep the search field focused through the tap (mousedown default
  // prevented), so the header doesn't re-expand under the finger mid-tap.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/[0.06] p-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${t("nbEditDetails")}: ${name}`}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 text-start transition-colors active:bg-accent/10"
        >
          <Initial name={name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span dir="ltr" className="block truncate text-start text-xs text-foreground/60 [unicode-bidi:plaintext]">{phone}</span>
          </span>
        </button>
        <Button type="button" variant="ghost" onClick={() => { setQuery(""); onClear(); }}
          className="h-11 shrink-0 rounded-xl px-3 font-semibold text-accent hover:bg-accent/10 hover:text-accent">
          {t("nbChange")}
        </Button>
      </div>
    );
  }

  const newButton = (
    <button type="button" onMouseDown={keepFocus} onClick={() => { searchRef.current?.blur(); onNew(query.trim()); }}
      className="flex min-h-11 w-full items-center gap-2 rounded-xl px-1 text-start text-sm font-semibold text-accent transition-colors active:bg-accent/10">
      <UserPlus className="h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 truncate">
        {t("walkInNewCustomer")}
        {query.trim() && <span className="font-normal text-foreground/60"> · <bdi>{query.trim()}</bdi></span>}
      </span>
    </button>
  );

  // A provider with no past customers has nothing to search: just the button.
  if (!isLoading && customers.length === 0) return newButton;

  return (
    <div ref={searchBoxRef} className="scroll-mt-1">
      <label htmlFor="walkin-search" className="sr-only">{t("nbSearch")}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-foreground/40" />
        <Input
          ref={searchRef}
          id="walkin-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={onSearchFocus}
          placeholder={t("nbSearch")}
          // 16px (no iOS zoom). The end padding is reserved for the clear
          // button only while it shows, so the longest placeholder (en, 266px
          // in DM Sans) fits the 283px a 375px sheet leaves.
          className={cn(
            "h-12 appearance-none rounded-xl ps-10 text-base [&::-webkit-search-cancel-button]:hidden",
            query ? "pe-11" : "pe-3",
          )}
        />
        {query && (
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setQuery("")}
            aria-label={t("clear")}
            className="absolute end-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-foreground/50 active:bg-foreground/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-1">{newButton}</div>

      {results.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-2xl border border-foreground/10 bg-white">
          {results.map((c, i) => (
            <li key={c.key} className={i > 0 ? "border-t border-foreground/[0.07]" : undefined}>
              <button type="button" onMouseDown={keepFocus} onClick={() => pick(c)}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start transition-colors active:bg-foreground/[0.04]">
                <Initial name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.name?.trim() || c.phone || t("customerFallback")}</span>
                  {c.phone && (
                    <span dir="ltr" className="mt-0.5 flex items-center gap-1 text-xs text-foreground/60 [justify-content:flex-start]">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.phone}</span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-semibold text-foreground/60">
                  {c.bookingCount} {t("bookingsUnit")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && !isLoading && (
        <p className="mt-1 px-1 text-xs text-foreground/60">{t("nbNoMatches")}</p>
      )}
    </div>
  );
}

function Initial({ name }: { name: string | null }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent" aria-hidden>
      {(name?.trim()?.[0] || "•").toUpperCase()}
    </span>
  );
}
