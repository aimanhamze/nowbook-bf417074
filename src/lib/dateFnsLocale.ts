import { he, ar, enUS } from "date-fns/locale";
import type { Locale } from "date-fns";
import type { Lang } from "./translations";

/** The date-fns locale for an app language. Hebrew is the default, as in LangContext. */
export function dateFnsLocaleFor(lang: Lang): Locale {
  if (lang === "ar") return ar;
  if (lang === "en") return enUS;
  return he;
}
