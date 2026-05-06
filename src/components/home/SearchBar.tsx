import { Search, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";

interface SearchBarProps {
  onNearbyClick?: () => void;
}

export function SearchBar({ onNearbyClick }: SearchBarProps) {
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
      <div className="flex items-center rounded-2xl border border-border bg-card ps-5 pe-2 py-2.5 shadow-[0_2px_16px_rgba(0,0,0,0.08)] transition-shadow focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.12)] focus-within:ring-1 focus-within:ring-accent/30">
        <div className="flex flex-1 min-w-0 items-center">
          <Search className="h-5 w-5 text-accent/50 shrink-0" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-0 ms-3 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="w-px h-5 bg-border shrink-0 mx-2 sm:mx-3" />
        <button
          type="button"
          onClick={onNearbyClick}
          className="flex items-center gap-1.5 bg-accent/10 text-accent px-3 py-2 rounded-xl text-xs font-semibold shrink-0 active:opacity-70 transition-opacity"
        >
          <MapPin className="h-3.5 w-3.5" />
          {t("nearby")}
        </button>
      </div>
    </form>
  );
}
