import { categories, categoryNames } from "@/lib/mock-data";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";

export function CategoryRow() {
  const navigate = useNavigate();
  const { lang } = useLang();

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none -mx-1.5 px-1.5">
      {categories.map((cat, i) => (
        <motion.button
          key={cat.id}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.03, duration: 0.3 }}
          onClick={() => navigate(`/explore?category=${cat.id}`)}
          className="flex items-center gap-1.5 min-w-fit px-4 py-2 rounded-full bg-card border border-border text-sm font-medium text-foreground hover:border-accent hover:text-accent transition-colors active:scale-95 whitespace-nowrap"
        >
          <span className="text-base">{cat.icon}</span>
          <span>{categoryNames[cat.id][lang]}</span>
        </motion.button>
      ))}
    </div>
  );
}
