import { Search } from "lucide-react";
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
      <div className="flex items-center gap-3 rounded-xl bg-muted px-4 py-3 transition-all focus-within:ring-2 focus-within:ring-accent/40">
        <Search className="h-5 w-5 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
      </div>
    </form>
  );
}
