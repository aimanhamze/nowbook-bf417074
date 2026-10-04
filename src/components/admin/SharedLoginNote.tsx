import { Info } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { Tables } from "@/integrations/supabase/types";

// Multi-branch: the email and password belong to the OWNER's login, which every
// branch shares — changing them for one branch changes them for all of them.
// Renders nothing for a single-branch owner (every owner today),
// so those dialogs are unchanged.
export function SharedLoginNote({ branches }: { branches: Tables<"provider_profiles">[] }) {
  const { t } = useLang();
  if (branches.length < 2) return null;

  return (
    <div className="flex gap-2 rounded-xl bg-secondary/70 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <p>{t("sharedLoginNote")}</p>
        <ul className="mt-1 space-y-0.5">
          {branches.map((b) => (
            <li key={b.id} className="truncate font-medium text-foreground">
              {b.business_name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
