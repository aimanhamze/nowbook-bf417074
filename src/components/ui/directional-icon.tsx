import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Home } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

type Variant = "chevron" | "arrow";

interface DirectionalIconProps {
  variant?: Variant;
  className?: string;
}

function pickIcon(pointsLeft: boolean, variant: Variant) {
  if (variant === "arrow") return pointsLeft ? ArrowLeft : ArrowRight;
  return pointsLeft ? ChevronLeft : ChevronRight;
}

export function BackArrow({ variant = "chevron", className }: DirectionalIconProps) {
  const { isRtl } = useLang();
  const Icon = pickIcon(!isRtl, variant);
  return <Icon className={className} />;
}

export function ForwardArrow({ variant = "chevron", className }: DirectionalIconProps) {
  const { isRtl } = useLang();
  const Icon = pickIcon(isRtl, variant);
  return <Icon className={className} />;
}

/** Back arrow, or a Home icon on a page the visitor landed on directly
 *  (see useSmartBack). Same size either way so the button never jumps. */
export function BackOrHomeIcon({ home, ...props }: DirectionalIconProps & { home: boolean }) {
  if (home) return <Home className={props.className} />;
  return <BackArrow {...props} />;
}
