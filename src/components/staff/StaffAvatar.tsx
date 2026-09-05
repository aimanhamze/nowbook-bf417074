import { cn } from "@/lib/utils";

// Four hues that sit on the warm provider gradient without fighting the accent:
// the accent's own orange, lavender (the gradient's tail), green, teal.
const HUES = [24, 265, 150, 200];

// Stable per member: the same person keeps the same colour across the roster,
// the member page and every reload, without storing anything.
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

interface Props {
  id: string;
  name: string;
  size?: "md" | "lg";
  /** Inactive members render grey so the roster's colour means "on the team". */
  muted?: boolean;
  className?: string;
}

export function StaffAvatar({ id, name, size = "md", muted = false, className }: Props) {
  const hue = hueFor(id);
  // First grapheme, not first UTF-16 unit — Hebrew and Arabic are fine either
  // way, but a name starting with an emoji or a surrogate pair would split.
  const initial = Array.from(name.trim())[0] ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "lg" ? "h-16 w-16 text-2xl" : "h-11 w-11 text-[15px]",
        className,
      )}
      style={
        muted
          ? { background: "hsl(220 10% 93%)", color: "hsl(220 8% 52%)" }
          : { background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 35%)` }
      }
    >
      {initial}
    </span>
  );
}
