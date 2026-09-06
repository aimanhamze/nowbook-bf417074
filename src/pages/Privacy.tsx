import { motion } from "framer-motion";
import { Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BackArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, fillBusiness } from "@/lib/businessInfo";
import { PRIVACY_SECTIONS } from "@/lib/privacySections";

/**
 * Public privacy policy (/privacy) — no auth, all three languages.
 *
 * Two things here are deliberate and load-bearing for a logged-out visitor,
 * which is the only kind of visitor this page is really built for (a Meta
 * Business Verification reviewer):
 *
 *  1. The language switcher. The app's only other switcher lives on Profile,
 *     behind ProtectedRoute — without this one a logged-out reader is stuck on
 *     whatever `book-lang` defaults to (Hebrew) with no way out.
 *  2. Back goes to "/" rather than navigate(-1). Someone who lands here from
 *     an external link has no history to go back to.
 *
 * Section text is translated; the business identity is not — it comes from
 * BUSINESS via fillBusiness(), so a legal name or number exists in exactly one
 * place. See src/lib/businessInfo.ts.
 */

const LANGUAGES = [["he", "עברית"], ["ar", "العربية"], ["en", "English"]] as const;

interface ContactTarget {
  value: string;
  href: string;
}

/**
 * Turns the email address and phone number inside a policy paragraph into real
 * mailto:/tel: links.
 *
 * A plain left-to-right scan rather than a regex: the needles are quoted
 * verbatim from BUSINESS, so an exact substring match is both sufficient and
 * safer than escaping arbitrary business names into a pattern. Each link is
 * dir="ltr" so it stays readable inside the Hebrew and Arabic body text.
 */
function linkifyContacts(text: string): React.ReactNode[] {
  const targets: ContactTarget[] = [
    { value: BUSINESS.email, href: `mailto:${BUSINESS.email}` },
    { value: BUSINESS.phone, href: `tel:${BUSINESS.phone}` },
  ].filter((target) => target.value.length > 0);

  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    // Earliest match wins, so the two targets can appear in any order.
    let hitIndex = -1;
    let hitTarget: ContactTarget | null = null;
    for (const target of targets) {
      const at = rest.indexOf(target.value);
      if (at !== -1 && (hitTarget === null || at < hitIndex)) {
        hitIndex = at;
        hitTarget = target;
      }
    }

    if (hitTarget === null) {
      nodes.push(rest);
      break;
    }

    if (hitIndex > 0) nodes.push(rest.slice(0, hitIndex));
    nodes.push(
      <a
        key={key++}
        href={hitTarget.href}
        dir="ltr"
        className="inline-block font-medium text-accent underline underline-offset-2"
      >
        {hitTarget.value}
      </a>
    );
    rest = rest.slice(hitIndex + hitTarget.value.length);
  }

  return nodes;
}

const Privacy = () => {
  const navigate = useNavigate();
  const { t, lang, setLang } = useLang();

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      {/* Safe-area aware top padding, matching Home — this page is reachable
          inside the installed PWA too. */}
      <header className="flex items-center gap-3 px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+2rem)]">
        <button
          onClick={() => navigate("/")}
          aria-label={t("privacyBackHomeAria")}
          className="rounded-xl p-1.5 transition-colors hover:bg-secondary active:scale-95"
        >
          <BackArrow className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">{t("privacyTitle")}</h1>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto w-full max-w-2xl px-5"
      >
        {/* Language switcher — mirrors the Profile one, minus the card chrome. */}
        <div className="mb-5 flex items-center gap-2">
          <Globe aria-hidden className="h-4 w-4 shrink-0 text-accent" />
          <span className="sr-only">{t("privacyLanguageLabel")}</span>
          <div className="flex flex-1 gap-2">
            {LANGUAGES.map(([code, label]) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={`flex-1 rounded-xl py-2 text-xs font-medium transition-all active:scale-[0.97] ${
                  lang === code
                    ? "bg-accent text-accent-foreground shadow-[0_8px_20px_-8px_hsl(24_80%_55%_/_0.6)]"
                    : "bg-white/60 text-foreground/70 hover:bg-white/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t("privacyLastUpdated")}</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{t("privacyIntro")}</p>

        <div className="mt-5 flex flex-col gap-3">
          {PRIVACY_SECTIONS.map(({ titleKey, bodyKey }) => (
            <section key={titleKey} className="glass-card-md rounded-2xl p-4">
              <h2 className="text-sm font-bold text-foreground">{t(titleKey)}</h2>
              {/* whitespace-pre-line renders the paragraph breaks and the
                  "• " bullet lines the translation strings carry. */}
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/75">
                {linkifyContacts(fillBusiness(t(bodyKey)))}
              </p>
            </section>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default Privacy;
