import { Children, isValidElement, useId, type ComponentType, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SettingsSwitch } from "@/components/dashboard/SettingsSwitch";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import { DIVIDER, GROUP_HEADING, LIST, ROW } from "./settingsList";

// Building blocks for the redesigned dashboard sections (profile, services,
// photos, packages), in the visual language of booking settings and opening
// hours: grouped glass lists with hairline dividers, a small muted heading, an
// accent icon tile at the row start, a title + one line, and a chevron when the
// row opens a sheet.

export type Icon = ComponentType<{ className?: string }>;

/** A titled glass list. Children are rows; falsy children are skipped and the
 *  first visible row gets no divider. */
// Inside a sheet (already a solid surface) a list is outlined, not glass.
export const SHEET_LIST = "overflow-hidden rounded-2xl border border-foreground/10 bg-white";

export function SettingsGroup({
  title,
  action,
  children,
  className,
  plain,
}: {
  title?: string;
  /** Rendered at the heading's end (e.g. an "Add" button). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Outlined list for use inside a sheet. */
  plain?: boolean;
}) {
  const rows = Children.toArray(children).filter((c) => isValidElement(c) || typeof c === "string");
  return (
    <section className={cn("space-y-2", className)}>
      {(title || action) && (
        <div className="flex min-h-[28px] items-end justify-between gap-3">
          {title && <h3 className={GROUP_HEADING}>{title}</h3>}
          {action}
        </div>
      )}
      {rows.length > 0 && (
        <ul className={plain ? SHEET_LIST : LIST}>
          {rows.map((row, i) => (
            <li key={i} className={i > 0 ? DIVIDER : undefined}>{row}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IconTile({ icon: Icon, className }: { icon: Icon; className?: string }) {
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent", className)}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export function RowText({
  title,
  description,
  descriptionDir,
  muted,
  lines = 1,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** e.g. "ltr" for a phone number shown under an RTL title. */
  descriptionDir?: "ltr" | "rtl" | "auto";
  /** The description is a placeholder ("Not set"), not a value. */
  muted?: boolean;
  lines?: 1 | 2;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold leading-snug">{title}</span>
      {description !== undefined && description !== null && description !== "" && (
        <span
          dir={descriptionDir}
          className={cn(
            "mt-0.5 block text-xs leading-snug",
            descriptionDir === "ltr" && "text-start [unicode-bidi:plaintext]",
            lines === 1 ? "truncate" : "line-clamp-2",
            muted ? "text-foreground/50" : "text-foreground/70",
          )}
        >
          {description}
        </span>
      )}
    </span>
  );
}

/** A row that opens a sheet: icon, title + one line, optional trailing value, chevron. */
export function NavRow({
  icon,
  leading,
  title,
  description,
  descriptionDir,
  muted,
  lines,
  value,
  onClick,
  className,
}: {
  icon?: Icon;
  /** Replaces the icon tile (e.g. a photo or colour). */
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  descriptionDir?: "ltr" | "rtl" | "auto";
  muted?: boolean;
  lines?: 1 | 2;
  value?: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className={cn(ROW, className)}>
      {leading ?? (icon && <IconTile icon={icon} />)}
      <RowText title={title} description={description} descriptionDir={descriptionDir} muted={muted} lines={lines} />
      {value !== undefined && <span className="shrink-0 text-sm font-medium text-foreground/70">{value}</span>}
      <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
    </button>
  );
}

/** The whole row is the switch's label, so the row is the tap target. */
export function SwitchRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon?: Icon;
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn(ROW, "cursor-pointer")}>
      {icon && <IconTile icon={icon} />}
      <RowText title={title} description={description} lines={2} />
      <SettingsSwitch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

/** A red action row (delete, cancel) — no icon tile, so it reads as an action. */
export function DangerRow({ icon: Icon, label, onClick, disabled }: { icon: Icon; label: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(ROW, "justify-center font-semibold text-red-600 disabled:opacity-50")}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="text-sm">{label}</span>
    </button>
  );
}

/**
 * The edit-sheet shell every redesigned section shares: grab handle, icon tile
 * + title (+ branch suffix when it writes), a scrolling body, and a sticky
 * footer above the safe area. Same container as the staff facet sheets, so the
 * provider UI keeps one idea of what an editing sheet is.
 *
 * `onSave` renders Save + Cancel; `footer` replaces them; neither = no footer.
 */
export function EditSheet({
  open,
  onClose,
  icon: Icon,
  title,
  description,
  writes = true,
  onSave,
  saving,
  saveDisabled,
  saveLabel,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon: Icon;
  title: ReactNode;
  description?: ReactNode;
  /** Shows the active branch after the title (multi-branch owners only). */
  writes?: boolean;
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t, isRtl } = useLang();
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <SheetContent
        side="bottom"
        dir={isRtl ? "rtl" : "ltr"}
        className={`flex max-h-[calc(var(--vvh,100dvh)*0.92)] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
        <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[17px] leading-snug">
                {title}
                {writes && <BranchSuffix />}
              </SheetTitle>
              {description ? (
                <SheetDescription className="mt-0.5 line-clamp-2 text-xs">{description}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">{title}</SheetDescription>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">{children}</div>

        {(footer || onSave) && (
          <div className="shrink-0 border-t border-border bg-background/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-sm">
            {footer ?? (
              <div className="flex gap-2">
                <Button onClick={onSave} disabled={saving || saveDisabled} className="h-12 flex-1 rounded-2xl text-base font-semibold">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saveLabel ?? t("save")}
                </Button>
                <Button variant="ghost" onClick={onClose} disabled={saving} className="h-12 rounded-2xl">
                  {t("cancel")}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A labelled field inside an edit sheet: label, control, optional help/error. */
export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">{error}</p>
      ) : help ? (
        <p className="text-xs leading-snug text-foreground/60">{help}</p>
      ) : null}
    </div>
  );
}
