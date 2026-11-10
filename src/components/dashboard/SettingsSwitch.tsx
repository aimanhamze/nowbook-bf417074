import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The switch used by the redesigned dashboard sections (booking settings,
 * opening hours). OFF reads as "tappable, currently off", not disabled: an
 * outlined track (foreground/50 ≈ 3.3:1 on the card, meeting the 3:1
 * non-text minimum) with a solid knob. ON keeps the accent track. Only a
 * truly `disabled` switch looks pale (the base Switch's opacity-50).
 *
 * It wraps the app-wide ui/switch.tsx without changing it. When the other
 * dashboard sections are redesigned, these classes move into the shared
 * Switch and this wrapper goes away.
 */
export const SettingsSwitch = forwardRef<
  ElementRef<typeof Switch>,
  ComponentPropsWithoutRef<typeof Switch>
>(({ className, ...props }, ref) => (
  <Switch
    ref={ref}
    className={cn(
      "data-[state=unchecked]:border-foreground/50 data-[state=unchecked]:bg-white",
      "[&[data-state=unchecked]>span]:bg-foreground/60 [&[data-state=unchecked]>span]:shadow-none",
      className,
    )}
    {...props}
  />
));
SettingsSwitch.displayName = "SettingsSwitch";
