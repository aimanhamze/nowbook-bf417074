import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { WaitlistLeaveDialog } from "@/components/booking/WaitlistLeaveDialog";
import { WaitlistDateChip } from "@/components/booking/WaitlistEntryCard";
import { entryWindows, useLeaveWaitlist, useMyWaitlist } from "@/hooks/useWaitlist";
import { waitlistDateLabel, waitlistWindowsLabel } from "@/lib/waitlistDay";
import type { Provider } from "@/lib/mock-data";

/**
 * "On the waiting list" on the provider page — ONE slim row under the
 * upcoming-appointment card, for the soonest active entry at this provider
 * (the rest are a "+N" link to /bookings, where every entry lives).
 *
 * Renders nothing — and runs no query — for a provider without the waiting
 * list, a visitor, a provider/admin account, or a customer with no entry here.
 */
export function WaitlistRow({ provider }: { provider: Provider }) {
  const { lang, t } = useLang();
  const { data: entries = [] } = useMyWaitlist(provider.waitlistEnabled);
  const leave = useLeaveWaitlist();
  const here = entries.filter((e) => e.provider_id === provider.id);
  const next = here[0];
  if (!provider.waitlistEnabled || !next) return null;
  const moreCount = here.length - 1;

  return (
    <section className="mt-3 px-5" aria-label={t("waitlistRowLabel")}>
      <div className="glass-card-md flex items-center gap-3 rounded-2xl p-2.5 pe-1.5">
        <WaitlistDateChip entryDate={next.entry_date} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-snug">{t("waitlistRowLabel")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {waitlistDateLabel(next.entry_date, lang)} · {waitlistWindowsLabel(entryWindows(next), t)}
          </p>
          {moreCount > 0 && (
            <Link to="/bookings" className="-my-3 inline-flex min-h-11 items-center text-xs font-semibold text-accent">
              {/* Isolate "+N" so an RTL line does not render it "N+". */}
              {t(moreCount === 1 ? "waitlistMoreOne" : "waitlistMore").replace("+{count}", `⁦+${moreCount}⁩`)}
            </Link>
          )}
        </div>
        <WaitlistLeaveDialog
          entryDate={next.entry_date}
          providerName={provider.name[lang]}
          onConfirm={() => leave.mutate(next.id)}
          trigger={
            <button
              type="button"
              disabled={leave.isPending}
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-red-600 transition-transform active:scale-95 disabled:opacity-50"
            >
              {t("waitlistLeave")}
            </button>
          }
        />
      </div>
    </section>
  );
}
