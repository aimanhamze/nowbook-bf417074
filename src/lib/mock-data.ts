import type { Lang } from "./translations";
import type { SocialLinks } from "./socialLinks";

export interface Service {
  id: string;
  name: Record<Lang, string>;
  duration: number;
  price: number;
  service_type?: 'private' | 'group';
  max_capacity?: number;
  scheduled_time?: string | null; // HH:MM — fixed time for group classes
  latest_start_time?: string | null; // HH:MM — customer cannot book after this time
}

export interface Provider {
  id: string;
  name: Record<Lang, string>;
  category: string;
  rating: number;
  reviewCount: number;
  image: string;
  coverImage: string;
  address: Record<Lang, string>;
  about: Record<Lang, string>;
  services: Service[];
  minLeadTimeMinutes: number;
  bookingWindowDays: number;
  socialLinks?: SocialLinks | null;
  requiresBookingApproval: boolean;
  showPrices: boolean;
  cancellationNoticeHours: number;
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
  { id: "dentist", icon: "🦷" },
  { id: "eye_doctor", icon: "👁️‍🗨️" },
  { id: "dermatologist", icon: "🩺" },
  { id: "aesthetic_medicine", icon: "💉" },
  { id: "physiotherapy", icon: "💪" },
  { id: "pediatrician", icon: "👶" },
  { id: "gym", icon: "🏋️" },
  { id: "fitness_studio", icon: "🤸" },
] as const;

export const beautyCategories = ["barber", "salon", "nails", "brows", "spa", "skincare", "makeup"] as const;
export const healthCategories = ["orthopedic", "dentist", "eye_doctor", "dermatologist", "aesthetic_medicine", "physiotherapy", "pediatrician"] as const;
export const fitnessCategories = ["gym", "fitness_studio"] as const;

export const categoryNames: Record<string, Record<Lang, string>> = {
  barber: { he: "ספר", ar: "حلاق", en: "Barber" },
  salon: { he: "מספרה", ar: "صالون شعر", en: "Hair Salon" },
  nails: { he: "ציפורניים", ar: "أظافر", en: "Nails" },
  brows: { he: "גבות וריסים", ar: "حواجب ورموش", en: "Brows & Lashes" },
  spa: { he: "ספא ועיסוי", ar: "سبا ومساج", en: "Spa & Massage" },
  skincare: { he: "טיפוח עור", ar: "العناية بالبشرة", en: "Skincare" },
  makeup: { he: "איפור", ar: "مكياج", en: "Makeup" },
  orthopedic: { he: "אורתופדיה", ar: "جراحة العظام", en: "Orthopedics" },
  dentist: { he: "רופא שיניים", ar: "طبيب أسنان", en: "Dentist" },
  eye_doctor: { he: "רופא עיניים", ar: "طبيب عيون", en: "Eye Doctor" },
  dermatologist: { he: "רופא עור", ar: "طبيب جلدية", en: "Dermatologist" },
  aesthetic_medicine: { he: "רפואה אסתטית", ar: "طب تجميلي", en: "Aesthetic Medicine" },
  physiotherapy: { he: "פיזיותרפיה", ar: "علاج طبيعي", en: "Physiotherapy" },
  pediatrician: { he: "רופא ילדים", ar: "طبيب أطفال", en: "Pediatrician" },
  gym: { he: "סטודיו אימונים", ar: "صالة رياضية", en: "Gym & Fitness" },
  fitness_studio: { he: "סטודיו כושר", ar: "استوديو لياقة", en: "Fitness Studio" },
};
