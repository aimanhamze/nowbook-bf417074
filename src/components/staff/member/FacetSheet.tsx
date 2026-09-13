import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";

interface Props {
  open: boolean;
  onClose: () => void;
  icon: LucideIcon;
  title: string;
  /** The member's name — the sheet edits ONE facet of ONE person, say which. */
  subtitle: string;
  onSave: () => void;
  saving: boolean;
  children: ReactNode;
}

/**
 * The shell every facet sheet shares: handle, icon + title + member name, a
 * scrolling body, and a sticky Save/Cancel footer above the safe area. Same
 * container pattern as the services editor and the old staff sheet, so the
 * provider UI keeps one idea of what a bottom sheet is.
 *
 * Each facet sheet owns ITS OWN draft and Save. That maps one-to-one onto the
 * four independent mutations the settings sheet already performed, so the
 * failure-open semantics and skip-when-unchanged discipline carry over without
 * any new partial-state logic.
 */
export function FacetSheet({ open, onClose, icon: Icon, title, subtitle, onSave, saving, children }: Props) {
  const { t } = useLang();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className={`flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
        <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[17px]">{title}</SheetTitle>
              <SheetDescription className="mt-0.5 truncate text-xs">{subtitle}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">{children}</div>

        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={saving} className="h-12 flex-1 text-base font-semibold">
              {t("save")}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={saving} className="h-12">
              {t("cancel")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
