// Service color coding — shared palette + hex helpers.
//
// The provider assigns one of eight preset colors to each service
// (provider_services.color) or class (provider_class_schedule.color). Colors are
// DISPLAY-ONLY and are rendered by the calendar exclusively while the master
// switch provider_profiles.service_colors_enabled is on; with it off the
// calendar ignores these values entirely and looks exactly as it did before.

/** DB default — every existing row was backfilled to this orange. */
export const DEFAULT_SERVICE_COLOR = "#f97316";

/** The eight swatches offered in the picker, in display order. */
export const SERVICE_COLOR_PRESETS = [
  "#f97316", // orange (default)
  "#3b82f6", // blue
  "#10b981", // green
  "#8b5cf6", // purple
  "#ef4444", // red
  "#f59e0b", // yellow
  "#ec4899", // pink
  "#6b7280", // gray
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Falls back to the default orange for anything that isn't a 6-digit hex, so a
 * legacy/NULL/garbage value can never produce an invalid style attribute.
 */
export function normalizeColor(color?: string | null): string {
  return color && HEX_RE.test(color) ? color : DEFAULT_SERVICE_COLOR;
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeColor(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

/** `rgba(...)` at the given alpha — used for card tints and chip fills. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Darker shade of the same hue, for text sitting on a light tint of that color.
 * `amount` is the fraction of the channel to remove (0.45 ≈ the darkness of a
 * Tailwind -800 next to a -100 background).
 */
export function darken(hex: string, amount = 0.45): string {
  const { r, g, b } = toRgb(hex);
  const f = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}
