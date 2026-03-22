import { User, Settings, LogIn, Bell, HelpCircle, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

const menuItems = [
  { icon: LogIn, label: "Sign in / Sign up" },
  { icon: Bell, label: "Notifications" },
  { icon: Settings, label: "Settings" },
  { icon: HelpCircle, label: "Help & Support" },
];

const Profile = () => {
  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold">Profile</h1>
      </header>

      {/* Avatar area */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="px-5 mb-8 flex items-center gap-4"
      >
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
          <User className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold">Guest</p>
          <p className="text-xs text-muted-foreground">Sign in to manage your bookings</p>
        </div>
      </motion.div>

      {/* Menu */}
      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {menuItems.map(({ icon: Icon, label }, i) => (
            <motion.button
              key={label}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="flex items-center justify-between w-full px-4 py-3.5 text-sm hover:bg-secondary/50 transition-colors active:scale-[0.99] border-b border-border last:border-0"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {label}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Profile;
