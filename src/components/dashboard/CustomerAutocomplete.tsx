import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, UserPlus, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderCustomers } from "@/hooks/useProviderCustomers";

interface CustomerAutocompleteProps {
  id?: string;
  value: string;
  /** Free typing in the name field (also clears any "selected" state). */
  onValueChange: (name: string) => void;
  /** A past customer was tapped — fill BOTH name + phone (still editable). */
  onSelectCustomer: (name: string, phone: string) => void;
  placeholder?: string;
}

const MAX_SUGGESTIONS = 6;

/** Strip everything but digits so "054-123" matches "0541234567". */
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Autocomplete over the provider's OWN past customers (reuses
 * useProviderCustomers — no new query, scoped to this provider). Matches on
 * name OR phone, case-insensitive / partial. Tapping a suggestion only
 * PRE-FILLS the name + phone text fields — it never links the booking to an
 * account; walk-ins stay user_id NULL with text name/phone.
 */
export function CustomerAutocomplete({
  id,
  value,
  onValueChange,
  onSelectCustomer,
  placeholder,
}: CustomerAutocompleteProps) {
  const { t } = useLang();
  const { data: customers = [] } = useProviderCustomers();

  const [focused, setFocused] = useState(false);
  // True once a suggestion is picked; reset the moment the provider edits the
  // name again (free typing) or hits the clear button.
  const [selected, setSelected] = useState(false);
  // Debounced copy of `value` used only for filtering (avoids list flicker).
  const [query, setQuery] = useState(value);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQuery(value), 120);
    return () => clearTimeout(id);
  }, [value]);

  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qDigits = digits(q);
    return customers
      .filter((c) => {
        const nameHit = (c.name || "").toLowerCase().includes(q);
        const phoneHit = qDigits.length > 0 && digits(c.phone || "").includes(qDigits);
        return nameHit || phoneHit;
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [customers, query]);

  // Show the dropdown only while focused, with text typed, not just-selected.
  const showList = focused && !selected && value.trim().length > 0;
  const showNewHint = showList && matches.length === 0;

  const handlePick = (name: string | null, phone: string | null) => {
    onSelectCustomer(name?.trim() || "", phone?.trim() || "");
    setSelected(true);
    setFocused(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          if (selected) setSelected(false);
          onValueChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        // Delay so a suggestion's onMouseDown registers before we close.
        onBlur={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => setFocused(false), 150);
        }}
        className={cn("h-12 pe-10", selected && "border-accent/60")}
      />

      {/* Trailing affordance: green check when selected (with clear), else nothing. */}
      {selected && (
        <div className="absolute inset-y-0 end-2 flex items-center gap-1">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent">
            <Check className="h-3 w-3 text-accent-foreground" />
          </span>
          <button
            type="button"
            aria-label={t("clear")}
            onClick={() => { setSelected(false); setFocused(true); }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-muted hover:text-foreground active:scale-90"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {(showList && matches.length > 0) && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-popover p-1.5 shadow-[0_12px_32px_-12px_hsl(var(--accent)/0.35)]"
            role="listbox"
          >
            {matches.map((c) => {
              const display = c.name?.trim() || c.phone || t("customerFallback");
              return (
                <li key={c.key} role="option" aria-selected={false}>
                  <button
                    type="button"
                    // onMouseDown (not onClick) so the pick fires before blur closes the list.
                    onMouseDown={(e) => { e.preventDefault(); handlePick(c.name, c.phone); }}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start transition-colors hover:bg-accent/10 active:scale-[0.99]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                      {(c.name?.trim()?.[0] || "•").toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{display}</span>
                      {c.phone && (
                        <span dir="ltr" className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground [justify-content:flex-start]">
                          <Phone className="h-3 w-3 shrink-0" />
                          {c.phone}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {c.bookingCount} {t("bookingsUnit")}
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Subtle, non-blocking "new customer" hint when nothing matches. */}
      <AnimatePresence>
        {showNewHint && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-x-0 top-full z-50 mt-1.5 flex items-center gap-2 rounded-2xl border border-dashed border-border bg-popover px-3 py-2.5 text-xs text-muted-foreground shadow-sm"
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0 text-accent" />
            {t("walkInNewCustomer")}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
