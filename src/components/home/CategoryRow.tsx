import { categories, categoryNames } from "@/lib/mock-data";
import { categoryIcons } from "@/lib/categoryIcons";
import { CategoryChip } from "@/components/CategoryChip";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";

/**
 * The single categories row on Home: one horizontally scrollable line of
 * compact icon+label pills covering ALL categories. Tapping a chip opens
 * Explore filtered by that category. Native flex scrolling + logical padding
 * keeps the scroll direction dir-aware in he/ar/en.
 */
export function CategoryRow() {
  const navigate = useNavigate();
  const { lang } = useLang();

  return (
    <div className="flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none [scroll-snap-type:x_proximity] [scroll-padding-inline-start:1.25rem]">
      {categories.map((cat) => (
        <CategoryChip
          key={cat.id}
          icon={categoryIcons[cat.id]}
          label={categoryNames[cat.id][lang]}
          onClick={() => navigate(`/explore?category=${cat.id}`)}
        />
      ))}
    </div>
  );
}
