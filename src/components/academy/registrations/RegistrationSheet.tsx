import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Ban, BookOpen, CheckCircle2, CircleDot, Clock, MessageCircle, Phone, User, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EditSheet, IconTile, RowText, SettingsGroup } from "@/components/dashboard/SettingsRows";
import { ROW } from "@/components/dashboard/settingsList";
import { useLang } from "@/contexts/LangContext";
import {
  useAcademyRegistrations,
  type ProviderRegistration,
  type RegistrationsScope,
} from "@/hooks/useAcademyRegistrations";
import type { AcademyCourseRow } from "@/integrations/supabase/academyTypes";
import { academyErrorMessage } from "@/lib/academyErrors";
import { labelIsPhone } from "@/lib/customerLabel";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { waLinkFromPhone } from "@/lib/whatsapp";
import { RegistrationStatusBadge } from "@/components/academy/customer/RegistrationStatusBadge";
import { useRegistrantName } from "./registrantName";

interface Props {
  /** The registration to show; null = closed. Its live row is read from the cache. */
  registrationId: string | null;
  onClose: () => void;
  course: AcademyCourseRow | null;
  /** "12–30 Nov" for the course, when it has sessions. */
  courseDates?: string | null;
  /**
   * The SAME registrations scope the caller lists from, so the actions'
   * optimistic update lands in the list the provider is looking at.
   */
  scope?: RegistrationsScope;
}

/**
 * One registration: who, which course, when they registered, status, and the
 * actions — WhatsApp / call, and by status:
 *   pending   → Approve (decide_course_registration 'confirmed')
 *               Decline (confirm first; decide_course_registration 'rejected')
 *   confirmed → Cancel registration (confirm first; cancel_course_registration)
 * The same RPCs, confirm dialogs and toasts as the cards this replaces; the
 * WhatsApp link opens a chat with no prefilled message, as before.
 */
export function RegistrationSheet({ registrationId, onClose, course, courseDates, scope }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const nameOf = useRegistrantName();
  const { registrations, decide, cancelAsProvider } = useAcademyRegistrations(scope);
  const [confirming, setConfirming] = useState<"reject" | "cancel" | null>(null);

  const r: ProviderRegistration | undefined = registrations.find((x) => x.id === registrationId);
  const open = registrationId !== null && !!r;
  const busy = decide.isPending || cancelAsProvider.isPending;
  const name = nameOf(r);
  const phone = r?.customer_phone ?? null;

  const runDecide = async (decision: "confirmed" | "rejected") => {
    if (!r) return;
    try {
      await decide.mutateAsync({ registration: r, decision, courseName: course?.name ?? "" });
      toast.success(decision === "confirmed" ? t("academyApprovedToast") : t("academyRejectedToast"));
      onClose();
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const runCancel = async () => {
    if (!r) return;
    try {
      await cancelAsProvider.mutateAsync({ registration: r, courseName: course?.name ?? "" });
      toast.success(t("academyCancelledToast"));
      onClose();
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const onConfirm = () => {
    const kind = confirming;
    setConfirming(null);
    if (kind === "reject") void runDecide("rejected");
    else if (kind === "cancel") void runCancel();
  };

  const footer =
    r?.status === "pending" ? (
      <div className="flex gap-2">
        <Button
          onClick={() => void runDecide("confirmed")}
          disabled={busy}
          className="h-12 flex-1 gap-1.5 rounded-2xl bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
        >
          <CheckCircle2 className="h-4 w-4" />
          {t("academyApprove")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirming("reject")}
          disabled={busy}
          className="h-12 flex-1 gap-1.5 rounded-2xl border-red-200 text-base font-semibold text-red-600 hover:bg-red-50 hover:text-red-600"
        >
          <XCircle className="h-4 w-4" />
          {t("academyReject")}
        </Button>
      </div>
    ) : r?.status === "confirmed" ? (
      <Button
        variant="outline"
        onClick={() => setConfirming("cancel")}
        disabled={busy}
        className="h-12 w-full gap-1.5 rounded-2xl border-red-200 text-base font-semibold text-red-600 hover:bg-red-50 hover:text-red-600"
      >
        <Ban className="h-4 w-4" />
        {t("academyCancelRegistration")}
      </Button>
    ) : undefined;

  return (
    <>
      <EditSheet
        open={open}
        onClose={onClose}
        icon={User}
        title={
          <bdi dir={r && labelIsPhone(r.customer_name, r.customer_phone) ? "ltr" : "auto"}>{name}</bdi>
        }
        footer={footer}
      >
        {r && (
          <>
            <SettingsGroup plain>
              <InfoRow icon={BookOpen} title={course?.name ?? "—"} description={courseDates ?? undefined} />
              <InfoRow
                icon={Phone}
                title={t("phone")}
                description={phone ? <bdi dir="ltr">{phone}</bdi> : t("pfNotSet")}
                muted={!phone}
              />
              <InfoRow
                icon={Clock}
                title={t("academyRegisteredAt").replace("{d}", format(parseISO(r.created_at), "d MMM yyyy, HH:mm", { locale }))}
              />
              <div className={ROW}>
                <IconTile icon={CircleDot} />
                <RowText title={t("acRegStatus")} />
                <RegistrationStatusBadge status={r.status} className="shrink-0" />
              </div>
            </SettingsGroup>

            {phone && (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={waLinkFromPhone(phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-white text-sm font-semibold text-emerald-700 transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
                <a
                  href={`tel:${phone}`}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-white text-sm font-semibold transition-colors active:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Phone className="h-4 w-4 text-accent" />
                  {t("call")}
                </a>
              </div>
            )}
          </>
        )}
      </EditSheet>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "reject" ? t("academyRejectConfirmTitle") : t("academyProviderCancelTitle").replace("{name}", name)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "reject" ? t("academyRejectConfirmBody") : t("academyProviderCancelBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirming === "reject" ? t("academyReject") : t("academyCancelRegistration")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InfoRow({
  icon,
  title,
  description,
  muted,
}: {
  icon: typeof Phone;
  title: React.ReactNode;
  description?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={ROW}>
      <IconTile icon={icon} />
      <RowText title={title} description={description} muted={muted} />
    </div>
  );
}
