import { MessageCircle, Phone } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { waLinkFromPhone } from "@/lib/whatsapp";

/** Customer name, then phone (tel:) and WhatsApp links — like the pending-bookings card. */
export function CustomerContact({ name, phone }: { name: string | null; phone: string | null }) {
  const { t } = useLang();
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{name || phone || t("academyUnknownCustomer")}</p>
      {phone && (
        <div className="mt-0.5 flex items-center gap-3">
          <a
            href={`tel:${phone}`}
            dir="ltr"
            className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Phone className="h-3 w-3" />
            {phone}
          </a>
          <a
            href={waLinkFromPhone(phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-xs text-emerald-600 transition-colors hover:text-emerald-700"
          >
            <MessageCircle className="h-3 w-3" />
            WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
