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
          className="glass-card-md flex flex-col items-center gap-2.5 min-w-[80px] py-3.5 px-2.5 rounded-2xl hover:bg-accent/[0.08] transition-colors active:scale-95"
        >
          <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-lg shrink-0">
            {cat.icon}
          </div>
          <span className="text-[11px] font-semibold tracking-tight text-foreground whitespace-nowrap">
            {categoryNames[cat.id][lang]}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
