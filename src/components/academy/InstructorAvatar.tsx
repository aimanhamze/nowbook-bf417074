import { cn } from "@/lib/utils";
import { StaffAvatar } from "@/components/staff/StaffAvatar";

interface Props {
  id: string;
  name: string;
  photoUrl: string | null;
  size?: "md" | "lg";
  muted?: boolean;
  className?: string;
}

/** The instructor's photo when there is one, else the staff-style initial. */
export function InstructorAvatar({ id, name, photoUrl, size = "md", muted = false, className }: Props) {
  if (!photoUrl) return <StaffAvatar id={id} name={name} size={size} muted={muted} className={className} />;
  return (
    <img
      src={photoUrl}
      alt=""
      loading="lazy"
      width={size === "lg" ? 64 : 44}
      height={size === "lg" ? 64 : 44}
      className={cn(
        "shrink-0 rounded-full object-cover",
        size === "lg" ? "h-16 w-16" : "h-11 w-11",
        muted && "opacity-60 grayscale",
        className,
      )}
    />
  );
}
