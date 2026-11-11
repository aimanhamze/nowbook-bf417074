import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderCustomers, type ProviderCustomer } from "@/hooks/useProviderCustomers";
import { looksLikePhone, rankCustomers, recentCustomers } from "@/lib/customerSearch";

type Mode = "search" | "picked" | "fields";

interface Props {
  name: string;
  phone: string;
  onNameChange: (name: string) => void;
  onPhoneChange: (phone: string) => void;
}

/**
 * Step 4's customer: a search over the provider's OWN past customers (the same
 * useProviderCustomers data the old autocomplete used), a compact card once
 * one is picked, or today's name + phone fields for a new customer.
 *
 * Picking only fills the name and phone text, exactly as before: it never
 * links the booking to an account (walk-ins stay user_id NULL; the phone is
 * stored as given and link_walkin_to_account matches it server-side).
 */
// Compact mode (header + footer stepping aside while typing) is decided by
// the sheet for every text field in step 4, not here.
export function CustomerPicker({ name, phone, onNameChange, onPhoneChange }: Props) {
  const { t } = useLang();
  const { data: customers = [], isLoading } = useProviderCustomers();

  const [mode, setMode] = useState<Mode>(() =>
    name.trim() && phone.trim() ? "picked" : name.trim() || phone.trim() ? "fields" : "search",
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<"name" | "phone" | null>(null);

  // A provider with no past customers has nothing to search: straight to the fields.
  useEffect(() => {
    if (mode === "search" && !isLoading && customers.length === 0) setMode("fields");
  }, [mode, isLoading, customers.length]);


  // "New customer" was tapped: focus the field it prefilled the other one of.
  useEffect(() => {
    if (mode !== "fields" || !focusNext.current) return;
    (focusNext.current === "phone" ? phoneRef : nameRef).current?.focus();
    focusNext.current = null;
  }, [mode]);

  const results = useMemo(
    () => (query.trim() ? rankCustomers(customers, query) : recentCustomers(customers)),
    [customers, query],
  );

  const pick = (c: ProviderCustomer) => {
    // Same fill as the old autocomplete's pick.
    const pickedName = c.name?.trim() || "";
    const pickedPhone = c.phone?.trim() || "";
    onNameChange(pickedName);
    onPhoneChange(pickedPhone);
    searchRef.current?.blur();
    // Missing half a record (a phone-only walk-in, say): open the fields so
    // the provider can complete it, instead of a card Create would reject.
    setMode(pickedName && pickedPhone ? "picked" : "fields");
  };

  const startNew = () => {
    const q = query.trim();
    if (q) {
      if (looksLikePhone(q)) {
        onPhoneChange(q);
        focusNext.current = "name";
      } else {
        onNameChange(q);
        focusNext.current = "phone";
      }
    } else {
      focusNext.current = "name";
    }
    searchRef.current?.blur();
    setMode("fields");
  };

  const change = () => {
    onNameChange("");
    onPhoneChange("");
    setQuery("");
    setMode("search");
  };

  // Rows keep the search field focused through the tap (mousedown default
  // prevented), so the header doesn't re-expand under the finger mid-tap.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  if (mode === "picked") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/[0.06] p-2">
        <button
          type="button"
          onClick={() => setMode("fields")}
          aria-label={`${t("nbEditDetails")}: ${name}`}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 text-start transition-colors active:bg-accent/10"
        >
          <Initial name={name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span dir="ltr" className="block truncate text-start text-xs text-foreground/60 [unicode-bidi:plaintext]">{phone}</span>
          </span>
        </button>
        <Button type="button" variant="ghost" onClick={change}
          className="h-11 shrink-0 rounded-xl px-3 font-semibold text-accent hover:bg-accent/10 hover:text-accent">
          {t("nbChange")}
        </Button>
      </div>
    );
  }

  if (mode === "fields") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="walkin-name" className="text-xs">
            {t("walkInCustomerName")} <span className="text-destructive">*</span>
          </Label>
          <Input
            ref={nameRef}
            id="walkin-name"
            autoComplete="off"
            // Keyboard action key: Next → the phone field (DOM order, so the
            // same in he/ar/en).
            enterKeyHint="next"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              phoneRef.current?.focus();
            }}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("walkInCustomerNamePlaceholder")}
            className="h-12"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="walkin-phone" className="text-xs">
            {t("walkInCustomerPhone")} <span className="text-destructive">*</span>
          </Label>
          <Input
            ref={phoneRef}
            id="walkin-phone"
            // Done → closes the keyboard (drops focus), bringing the footer back.
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.currentTarget.blur();
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder={t("walkInCustomerPhonePlaceholder")}
            className="h-12"
          />
        </div>
        {customers.length > 0 && (
          <Button type="button" variant="ghost" onClick={() => { setQuery(""); setMode("search"); }}
            className="h-11 w-full gap-2 rounded-xl text-accent hover:bg-accent/10 hover:text-accent">
            <Search className="h-4 w-4" />
            {t("nbFindExisting")}
          </Button>
        )}
      </div>
    );
  }

  // ── Search ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Pinned to the top of the step's scroller: results scroll under it, so
          a long list can never push the field off screen. */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 bg-background px-5 pb-2 pt-4">
        <label htmlFor="walkin-search" className="sr-only">{t("nbSearch")}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-foreground/40" />
          <Input
            ref={searchRef}
            id="walkin-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nbSearch")}
            className="h-12 appearance-none rounded-xl pe-11 ps-11 text-base [&::-webkit-search-cancel-button]:hidden"
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
      </div>

      {!query.trim() && results.length > 0 && (
        <p className="mb-1.5 mt-1 px-1 text-xs font-semibold text-foreground/60">{t("nbRecent")}</p>
      )}
      <ul className="mt-1 overflow-hidden rounded-2xl border border-foreground/10 bg-white">
        <li>
          <button type="button" onMouseDown={keepFocus} onClick={startNew}
            className="flex min-h-14 w-full items-center gap-3 px-3 text-start text-accent transition-colors active:bg-accent/10">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
              <UserPlus className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {t("walkInNewCustomer")}
              {query.trim() && <span className="font-normal text-foreground/60"> · <bdi>{query.trim()}</bdi></span>}
            </span>
          </button>
        </li>
        {results.map((c) => (
          <li key={c.key} className="border-t border-foreground/[0.07]">
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
      {query.trim() && results.length === 0 && !isLoading && (
        <p className="mt-2 px-1 text-xs text-foreground/60">{t("nbNoMatches")}</p>
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
