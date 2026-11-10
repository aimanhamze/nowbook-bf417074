import { useLang } from "@/contexts/LangContext";
import { translations, type Lang } from "@/lib/translations";
import { plural, type PluralForms } from "@/lib/dashboardSetup";

/**
 * Plural lookup across CLDR-suffixed translation keys: `pl("bsDays", 14)`
 * reads bsDays_one / _two / _few / _many / _other for the active language and
 * lets Intl.PluralRules pick (Arabic needs all five; Hebrew and English get
 * by with one/other, plus Hebrew's "two"). A missing form falls back to _other.
 */
export function usePlural() {
  const { lang } = useLang();
  const table = translations[lang] as unknown as Record<string, string>;
  return (base: string, n: number) => {
    const forms: PluralForms = { other: table[`${base}_other`] ?? "{n}" };
    for (const c of ["zero", "one", "two", "few", "many"] as const) {
      if (table[`${base}_${c}`]) forms[c] = table[`${base}_${c}`];
    }
    return plural(lang as Lang, n, forms);
  };
}
