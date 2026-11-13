import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BackArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";

export type CustomerViewKind = "new" | "edit" | "complete";

interface Props {
  /** new = "+ New customer"; edit = the picked card was tapped; complete = a
   *  past customer missing a name or phone. */
  kind: CustomerViewKind;
  initialName: string;
  initialPhone: string;
  /** Leave without saving. */
  onBack: () => void;
  /** Valid name + phone, exactly as typed. */
  onCommit: (name: string, phone: string) => void;
}

/**
 * The new-customer view of the new-appointment sheet (the Fresha / Schedulista
 * pattern). It replaces step 4's content AND the sheet's header and footer:
 * back · title · Add sit at the TOP, so the keyboard can never cover the
 * action, and the body is only the two fields.
 *
 * Validation is today's: a name and a phone are required (the same translated
 * messages Create used). The values go back exactly as typed — Create trims
 * them and stores the phone as given, as before. Consent stays on step 4 and
 * is still checked at Create.
 */
export function NewCustomerView({ kind, initialName, initialPhone, onBack, onCommit }: Props) {
  const { t } = useLang();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // The provider tapped "+ New customer" / the card to get here, so the first
  // empty field takes the caret (the keyboard is expected now).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const target = initialName.trim() && !initialPhone.trim() ? phoneRef : nameRef;
      target.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const next: { name?: string; phone?: string } = {};
    if (!name.trim()) next.name = t("walkInNameRequired");
    if (!phone.trim()) next.phone = t("walkInPhoneRequired");
    if (next.name || next.phone) {
      setErrors(next);
      (next.name ? nameRef : phoneRef).current?.focus();
      return;
    }
    // Close the keyboard so step 4 comes back with its footer.
    (document.activeElement as HTMLElement | null)?.blur?.();
    onCommit(name, phone);
  };

  const title = kind === "new" ? t("walkInNewCustomer") : t("nbEditDetails");
  const action = kind === "edit" ? t("save") : t("nbAdd");

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors active:bg-foreground/[0.06]"
        >
          <BackArrow className="h-5 w-5" />
        </button>
        <SheetTitle className="min-w-0 flex-1 truncate text-lg">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        <Button type="button" onClick={submit} className="h-11 shrink-0 rounded-xl px-5 text-base font-semibold">
          {action}
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto border-t border-border/60 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="walkin-name" className="text-xs">
            {t("walkInCustomerName")} <span className="text-destructive">*</span>
          </Label>
          <Input
            ref={nameRef}
            id="walkin-name"
            autoComplete="off"
            // Next → the phone field (DOM order, so the same in he/ar/en).
            enterKeyHint="next"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              phoneRef.current?.focus();
            }}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
            }}
            placeholder={t("walkInCustomerNamePlaceholder")}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? "walkin-name-error" : undefined}
            className={cn("h-12", errors.name && "border-destructive")}
          />
          {errors.name && <p id="walkin-name-error" role="alert" className="text-xs text-destructive">{errors.name}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="walkin-phone" className="text-xs">
            {t("walkInCustomerPhone")} <span className="text-destructive">*</span>
          </Label>
          <Input
            ref={phoneRef}
            id="walkin-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            // Done = the same as tapping Add.
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              submit();
            }}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (errors.phone) setErrors((er) => ({ ...er, phone: undefined }));
            }}
            placeholder={t("walkInCustomerPhonePlaceholder")}
            aria-invalid={!!errors.phone || undefined}
            aria-describedby={errors.phone ? "walkin-phone-error" : undefined}
            className={cn("h-12", errors.phone && "border-destructive")}
          />
          {errors.phone && <p id="walkin-phone-error" role="alert" className="text-xs text-destructive">{errors.phone}</p>}
        </div>
      </div>
    </>
  );
}
