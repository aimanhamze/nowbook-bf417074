import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

const Favorites = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold">Favorites</h1>
      </header>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="px-5 flex flex-col items-center justify-center py-20"
      >
        <Heart className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <p className="text-muted-foreground text-sm mb-1">No favorites yet</p>
        <p className="text-xs text-muted-foreground mb-4">Tap the heart on providers you love</p>
        <button
          onClick={() => navigate("/explore")}
          className="px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Browse Providers
        </button>
      </motion.div>
    </div>
  );
};

export default Favorites;
