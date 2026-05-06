import { cn } from "@/lib/utils";

interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <h2 className={cn("flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>
      <span aria-hidden className="block h-3.5 w-1 rounded-full bg-accent" />
      {children}
    </h2>
  );
}
