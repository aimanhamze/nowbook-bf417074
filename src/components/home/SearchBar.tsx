import { Search, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { t } = useLang();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/explore?q=${encodeURIComponent(query)}`);
    } else {
      navigate("/explore");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-accent/30">
        <Search className="h-5 w-5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
        <button type="button" className="flex items-center gap-1 text-xs text-accent font-medium shrink-0">
          <MapPin className="h-3.5 w-3.5" />
          {t("nearby")}
        </button>
      </div>
    </form>
  );
}
