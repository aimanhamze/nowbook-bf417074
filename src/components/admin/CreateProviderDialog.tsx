import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { categories } from "@/lib/mock-data";

const categoryLabels: Record<string, string> = {
  barber: "💈 ספר",
  salon: "💇 מספרה",
  nails: "💅 ציפורניים",
  brows: "👁️ גבות",
  spa: "🧖 ספא",
  skincare: "✨ טיפוח עור",
  makeup: "💄 איפור",
  orthopedic: "🦴 אורתופד",
  dentist: "🦷 רפואת שיניים",
  eye_doctor: "👁️‍🗨️ רופא עיניים",
  dermatologist: "🩺 עור ואסתטיקה",
  aesthetic_medicine: "💉 רפואה אסתטית",
  physiotherapy: "💪 פיזיותרפיה",
  pediatrician: "👶 רופא ילדים",
  gym: "🏋️ סטודיו אימונים",
  fitness_studio: "🤸 סטודיו כושר",
};

type CreatedCredentials = { email: string; password: string; businessName: string };

export function CreateProviderDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("barber");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const createProvider = useMutation({
    mutationFn: async () => {
      if (!email.trim() || !password.trim() || !businessName.trim()) {
        throw new Error("יש למלא אימייל, סיסמה ושם עסק");
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("לא מחובר");

      const { data, error } = await supabase.functions.invoke("create-provider", {
        body: {
          email: email.trim(),
          password,
          display_name: displayName.trim() || businessName.trim(),
          business_name: businessName.trim(),
          category,
          city: city.trim(),
          phone: phone.trim(),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-roles"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
      setCredentials({ email: email.trim(), password, businessName: businessName.trim() });
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה ביצירת ספק");
    },
  });

  const handleCopy = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(`אימייל: ${credentials.email}\nסיסמה: ${credentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setEmail("");
      setPassword("");
      setDisplayName("");
      setBusinessName("");
      setCategory("barber");
      setCity("");
      setPhone("");
      setCredentials(null);
      setCopied(false);
    }
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          הוסף ספק
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>יצירת ספק חדש</DialogTitle>
        </DialogHeader>

        {credentials ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2 text-sm">
              <p className="font-semibold text-green-700">✅ הספק "{credentials.businessName}" נוצר בהצלחה!</p>
              <p className="text-muted-foreground">פרטי כניסה:</p>
              <div className="font-mono bg-white rounded-lg border p-3 space-y-1 text-xs">
                <p>אימייל: <span className="font-bold">{credentials.email}</span></p>
                <p>סיסמה: <span className="font-bold">{credentials.password}</span></p>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "הועתק!" : "העתק פרטים"}
              </Button>
            </div>
            <Button className="w-full" onClick={() => handleClose(false)}>סגור</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div>
              <Label>אימייל *</Label>
              <Input
                type="email"
                dir="ltr"
                placeholder="provider@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <Label>סיסמה *</Label>
              <Input
                type="text"
                dir="ltr"
                placeholder="לפחות 6 תווים"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <Label>שם מלא</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="שם הבעלים / איש הקשר"
              />
            </div>

            <div>
              <Label>שם העסק *</Label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>

            <div>
              <Label>קטגוריה</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {categoryLabels[c.id] || c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>עיר</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>

            <div>
              <Label>טלפון</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr" />
            </div>

            <Button
              className="w-full"
              onClick={() => createProvider.mutate()}
              disabled={!email.trim() || !password.trim() || !businessName.trim() || createProvider.isPending}
            >
              {createProvider.isPending ? "יוצר..." : "צור ספק"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
