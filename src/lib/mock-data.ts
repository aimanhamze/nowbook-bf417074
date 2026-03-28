import type { Lang } from "./translations";

export interface Service {
  id: string;
  name: Record<Lang, string>;
  duration: number;
  price: number;
}

export interface Provider {
  id: string;
  name: Record<Lang, string>;
  category: string;
  rating: number;
  reviewCount: number;
  distance: string;
  image: string;
  coverImage: string;
  address: Record<Lang, string>;
  about: Record<Lang, string>;
  services: Service[];
  photos: string[];
  workingHours: { day: Record<Lang, string>; hours: string }[];
  reviews: { name: string; rating: number; comment: Record<Lang, string>; date: Record<Lang, string> }[];
}

export const categories = [
  { id: "barber", icon: "✂️" },
  { id: "salon", icon: "💇" },
  { id: "nails", icon: "💅" },
  { id: "brows", icon: "👁️" },
  { id: "spa", icon: "🧖" },
  { id: "skincare", icon: "✨" },
  { id: "makeup", icon: "💄" },
  { id: "orthopedic", icon: "🦴" },
] as const;

export const categoryNames: Record<string, Record<Lang, string>> = {
  barber: { he: "ספר", ar: "حلاق", en: "Barber" },
  salon: { he: "מספרה", ar: "صالون شعر", en: "Hair Salon" },
  nails: { he: "ציפורניים", ar: "أظافر", en: "Nails" },
  brows: { he: "גבות וריסים", ar: "حواجب ورموش", en: "Brows & Lashes" },
  spa: { he: "ספא ועיסוי", ar: "سبا ومساج", en: "Spa & Massage" },
  skincare: { he: "טיפוח עור", ar: "العناية بالبشرة", en: "Skincare" },
  makeup: { he: "איפור", ar: "مكياج", en: "Makeup" },
  orthopedic: { he: "אורתופדיה", ar: "جراحة العظام", en: "Orthopedics" },
};

export const providers: Provider[] = [];

export const timeSlots = [
  "9:00", "9:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30",
  "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30",
];

export const getAvailableSlots = (_providerId: string, _date: Date): string[] => {
  const seed = _date.getDate();
  return timeSlots.filter((_, i) => (i + seed) % 3 !== 0);
};
