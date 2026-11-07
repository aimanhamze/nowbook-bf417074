import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { ForwardArrow } from "@/components/ui/directional-icon";
import type { AcademyInstructorRow } from "@/integrations/supabase/academyTypes";
import { InstructorAvatar } from "./InstructorAvatar";

interface Props {
  instructors: AcademyInstructorRow[];
  onOpen: (id: string) => void;
}

/**
 * Same shape as the staff roster: active instructors first, inactive ones under
 * a collapsed disclosure. Each row is one button to the instructor page; nothing
 * is edited inline.
 */
export function InstructorRoster({ instructors, onOpen }: Props) {
  const { t } = useLang();
  const [showInactive, setShowInactive] = useState(false);
  const active = instructors.filter((i) => i.is_active);
  const inactive = instructors.filter((i) => !i.is_active);

  return (
    <section>
      <div className="flex flex-col gap-2">
        {active.map((i, index) => (
          <InstructorRow key={i.id} instructor={i} index={index} onOpen={onOpen} />
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="flex min-h-11 w-full items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-muted-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showInactive ? "rotate-180" : ""}`} />
            <span>{t("academyInstructorsInactiveGroup").replace("{n}", String(inactive.length))}</span>
          </button>
          {showInactive && (
            <div className="flex flex-col gap-2">
              {inactive.map((i, index) => (
                <InstructorRow key={i.id} instructor={i} index={index} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InstructorRow({
  instructor,
  index,
  onOpen,
}: {
  instructor: AcademyInstructorRow;
  index: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={() => onOpen(instructor.id)}
      className={`surface-soft flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start transition-transform active:scale-[0.99] ${
        instructor.is_active ? "" : "opacity-75"
      }`}
    >
      <InstructorAvatar
        id={instructor.id}
        name={instructor.name}
        photoUrl={instructor.photo_url}
        muted={!instructor.is_active}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[15px] font-semibold ${instructor.is_active ? "" : "text-muted-foreground line-through"}`}>
          {instructor.name}
        </span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {instructor.is_active ? instructor.bio || "" : t("academyInstructorInactive")}
        </span>
      </span>
      <ForwardArrow className="h-4 w-4 shrink-0 text-muted-foreground" />
    </motion.button>
  );
}
