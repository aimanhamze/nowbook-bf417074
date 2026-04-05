import { categories, categoryNames } from "@/lib/mock-data";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";

interface CategoryRowProps {
  filter?: string[];
}

export function CategoryRow({ filter }: CategoryRowProps) {
  const navigate = useNavigate();
  const { lang } = useLang();

  const filtered = filter
    ? categories.filter((cat) => filter.includes(cat.id))
    : categories;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-1.5 px-1.5">
      {filtered.map((cat, i) => (
        <motion.button
          key={cat.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => navigate(`/explore?category=${cat.id}`)}
          className="flex flex-col items-center gap-2 min-w-[72px] py-3 px-2 rounded-2xl bg-secondary hover:bg-accent/10 transition-colors active:scale-95"
        >
          <span className="text-2xl">{cat.icon}</span>
          <span className="text-xs font-medium text-foreground whitespace-nowrap">{categoryNames[cat.id][lang]}</span>
        </motion.button>
      ))}
    </div>
  );
}
