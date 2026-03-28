import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-4 pointer-events-auto", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0 w-full",
        month: "space-y-5 w-full",
        caption: "flex justify-center pt-1 relative items-center px-1",
        caption_label: "text-base font-bold tracking-tight text-foreground",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          "h-9 w-9 inline-flex items-center justify-center rounded-xl",
          "bg-secondary text-foreground hover:bg-accent hover:text-accent-foreground",
          "transition-colors duration-200"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse",
        head_row: "flex w-full",
        head_cell: cn(
          "text-muted-foreground rounded-lg w-full font-semibold text-[0.7rem] uppercase tracking-wider py-2"
        ),
        row: "flex w-full mt-1",
        cell: cn(
          "relative p-0.5 text-center text-sm focus-within:relative focus-within:z-20 w-full",
          "[&:has([aria-selected])]:bg-accent/10 [&:has([aria-selected])]:rounded-xl",
          "[&:has([aria-selected].day-range-end)]:rounded-r-xl",
          "first:[&:has([aria-selected])]:rounded-l-xl last:[&:has([aria-selected])]:rounded-r-xl"
        ),
        day: cn(
          "h-10 w-full rounded-xl font-medium transition-all duration-200",
          "inline-flex items-center justify-center",
          "hover:bg-accent/15 hover:text-accent-foreground hover:scale-105",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "aria-selected:opacity-100"
        ),
        day_range_end: "day-range-end",
        day_selected: cn(
          "bg-accent text-accent-foreground shadow-md shadow-accent/25",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:bg-accent focus:text-accent-foreground",
          "font-bold scale-105"
        ),
        day_today: cn(
          "bg-primary/10 text-primary font-bold",
          "ring-1 ring-primary/20"
        ),
        day_outside: "day-outside text-muted-foreground/40 aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground/30",
        day_range_middle: "aria-selected:bg-accent/10 aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
