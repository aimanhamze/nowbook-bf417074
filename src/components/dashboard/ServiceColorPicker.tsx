import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { SERVICE_COLOR_PRESETS, normalizeColor } from "@/lib/serviceColors";

/**
 * Eight-swatch color picker for a service / class. Rendered ONLY when the
 * provider's master switch (provider_profiles.service_colors_enabled) is on —
 * the callers gate it, this component itself is presentational.
 */
export function ServiceColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const selected = normalizeColor(value);

  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground mb-1.5">{t("serviceColor")}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("chooseColor")}>
        {SERVICE_COLOR_PRESETS.map((color) => {
          const isSelected = selected.toLowerCase() === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={color}
              title={color}
              onClick={() => onChange(color)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-all active:scale-90",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                isSelected ? "ring-2 ring-offset-2 ring-foreground/30 scale-105" : "hover:scale-105",
              )}
              style={{ backgroundColor: color }}
            >
              {isSelected && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
