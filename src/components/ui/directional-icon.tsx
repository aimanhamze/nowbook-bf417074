import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
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
