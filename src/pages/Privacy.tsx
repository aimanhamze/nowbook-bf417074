import { motion } from "framer-motion";
import { Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BackArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue, telHref } from "@/lib/businessInfo";
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
 * This is the one page that names the registered operator (BUSINESS.legalName)
 * — stating who stands behind the service is the section's whole purpose. No
 * other surface may show it. See src/lib/businessInfo.ts.
 */

const LANGUAGES = [["he", "עברית"], ["ar", "العربية"], ["en", "English"]] as const;

type SlotKind = "name" | "code" | "tel" | "mail";

interface Slot {
  token: string;
  value: string;
  kind: SlotKind;
}

/**
 * The business details the policy text can reference.
 *
 * Substitution happens on the SLOT TOKEN, not on the resolved value: scanning
 * the finished sentence for, say, a business name would misfire the moment a
 * name happened to occur in ordinary prose. The token is unambiguous.
 */
const SLOTS: Slot[] = [
  { token: "{tradeName}", value: BUSINESS.tradeName, kind: "name" },
  { token: "{legalName}", value: BUSINESS.legalName, kind: "name" },
  { token: "{vat}", value: BUSINESS.vatNumber, kind: "code" },
  // The policy quotes the number of record only — never the secondary line.
  { token: "{phonePrimary}", value: BUSINESS.phonePrimary, kind: "tel" },
  { token: "{email}", value: BUSINESS.email, kind: "mail" },
];

const LINK_CLASS = "inline-block font-medium text-accent underline underline-offset-2";

function renderSlot(slot: Slot, key: number) {
  switch (slot.kind) {
    case "tel":
      return (
        <a key={key} href={telHref(slot.value)} dir="ltr" className={LINK_CLASS}>
          {slot.value}
        </a>
      );
    case "mail":
      return (
        <a key={key} href={`mailto:${slot.value}`} dir="ltr" className={LINK_CLASS}>
          {slot.value}
        </a>
      );
    case "code":
      // Digits only — always Latin order, even mid-sentence in he/ar.
      return (
        <span key={key} dir="ltr" className="inline-block">
          {slot.value}
        </span>
      );
    case "name":
    default:
      // dir="auto" isolates the name from the sentence around it, so a Hebrew
      // business name keeps its own direction (and its neighbouring commas and
      // full stops stay put) inside the English and Arabic text. "auto" rather
      // than "rtl" so a future Latin trade name is handled correctly too.
      return (
        <span key={key} dir="auto" className="inline-block">
          {slot.value}
        </span>
      );
  }
}

/** True when every slot the text references actually has a value. */
function isComplete(text: string): boolean {
  return SLOTS.every((slot) => !text.includes(slot.token) || hasValue(slot.value));
}

/**
 * Replaces every business slot in a policy paragraph with its rendered node.
 * A plain left-to-right scan, earliest token first — no regex, so no escaping
 * of business names into a pattern.
 */
function renderBody(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    let hitIndex = -1;
    let hitSlot: Slot | null = null;
    for (const slot of SLOTS) {
      const at = rest.indexOf(slot.token);
      if (at !== -1 && (hitSlot === null || at < hitIndex)) {
        hitIndex = at;
        hitSlot = slot;
      }
    }

    if (hitSlot === null) {
      nodes.push(rest);
      break;
    }

    if (hitIndex > 0) nodes.push(rest.slice(0, hitIndex));
    nodes.push(renderSlot(hitSlot, key++));
    rest = rest.slice(hitIndex + hitSlot.token.length);
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
          {PRIVACY_SECTIONS.map(({ titleKey, bodyKey, optionalBodyKey }) => {
            const optional = optionalBodyKey ? t(optionalBodyKey) : null;
            return (
              <section key={titleKey} className="glass-card-md rounded-2xl p-4">
                <h2 className="text-sm font-bold text-foreground">{t(titleKey)}</h2>
                {/* whitespace-pre-line renders the paragraph breaks and the
                    "• " bullet lines the translation strings carry. */}
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/75">
                  {renderBody(t(bodyKey))}
                </p>
                {optional && isComplete(optional) && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/75">
                    {renderBody(optional)}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default Privacy;
