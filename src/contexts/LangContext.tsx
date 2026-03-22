import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { translations, type Lang, type TranslationKey } from "@/lib/translations";

interface LangContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
  isRtl: boolean;
}

const LangContext = createContext<LangContextType | undefined>(undefined);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("book-lang");
    return (saved === "he" || saved === "ar" || saved === "en") ? saved : "he";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("book-lang", l);
  };

  const t = (key: TranslationKey): string => {
    return translations[lang][key] || key;
  };

  const isRtl = lang === "he" || lang === "ar";

  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, isRtl]);

  return (
    <LangContext.Provider value={{ lang, setLang, t, isRtl }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
