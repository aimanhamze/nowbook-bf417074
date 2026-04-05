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
  { id: "dentist", icon: "🦷" },
  { id: "eye_doctor", icon: "👁️‍🗨️" },
  { id: "dermatologist", icon: "🩺" },
  { id: "physiotherapy", icon: "💪" },
  { id: "pediatrician", icon: "👶" },
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
  dentist: { he: "רופא שיניים", ar: "طبيب أسنان", en: "Dentist" },
  eye_doctor: { he: "רופא עיניים", ar: "طبيب عيون", en: "Eye Doctor" },
  dermatologist: { he: "רופא עור", ar: "طبيب جلدية", en: "Dermatologist" },
  physiotherapy: { he: "פיזיותרפיה", ar: "علاج طبيعي", en: "Physiotherapy" },
  pediatrician: { he: "רופא ילדים", ar: "طبيب أطفال", en: "Pediatrician" },
};

export const providers: Provider[] = [
  {
    id: "mock-dentist-1",
    name: { he: "Mohamad Abo Raya", ar: "محمد أبو ريا", en: "Mohamad Abo Raya" },
    category: "dentist",
    rating: 4.8,
    reviewCount: 124,
    distance: "2.3 km",
    image: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&h=400&fit=crop",
    address: { he: "חיפה, רח׳ הנמל 12", ar: "حيفا، شارع الميناء 12", en: "12 HaNamal St, Haifa" },
    about: {
      he: "מרפאת שיניים מקצועית עם ניסיון של למעלה מ-15 שנה. התמחות בטיפולי שיניים מתקדמים, הלבנות, כתרים והשתלות.",
      ar: "عيادة أسنان متخصصة مع خبرة تزيد عن 15 عامًا. تخصص في علاجات الأسنان المتقدمة والتبييض والتيجان وزراعة الأسنان.",
      en: "Professional dental clinic with over 15 years of experience. Specializing in advanced dental treatments, whitening, crowns, and implants.",
    },
    services: [
      { id: "s-dent-1", name: { he: "בדיקה כללית", ar: "فحص عام", en: "General Checkup" }, duration: 30, price: 150 },
      { id: "s-dent-2", name: { he: "הלבנת שיניים", ar: "تبييض أسنان", en: "Teeth Whitening" }, duration: 60, price: 800 },
      { id: "s-dent-3", name: { he: "עקירת שן", ar: "خلع سن", en: "Tooth Extraction" }, duration: 45, price: 400 },
      { id: "s-dent-4", name: { he: "סתימה", ar: "حشوة", en: "Filling" }, duration: 30, price: 250 },
      { id: "s-dent-5", name: { he: "ניקוי אבנית", ar: "تنظيف الجير", en: "Scaling & Cleaning" }, duration: 45, price: 350 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=600",
      "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=600",
    ],
    workingHours: [
      { day: { he: "ראשון-חמישי", ar: "الأحد-الخميس", en: "Sun-Thu" }, hours: "09:00-18:00" },
      { day: { he: "שישי", ar: "الجمعة", en: "Fri" }, hours: "09:00-13:00" },
    ],
    reviews: [
      { name: "יוסי כ.", rating: 5, comment: { he: "רופא מעולה, מקצועי ונעים", ar: "طبيب ممتاز، محترف ولطيف", en: "Excellent doctor, professional and pleasant" }, date: { he: "לפני שבוע", ar: "قبل أسبوع", en: "1 week ago" } },
      { name: "סארה מ.", rating: 5, comment: { he: "המרפאה נקייה ומודרנית, ממליצה בחום", ar: "العيادة نظيفة وحديثة، أنصح بشدة", en: "Clean and modern clinic, highly recommended" }, date: { he: "לפני חודש", ar: "قبل شهر", en: "1 month ago" } },
    ],
  },
];

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
