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
] as const;

export const categoryNames: Record<string, Record<Lang, string>> = {
  barber: { he: "ספר", ar: "حلاق", en: "Barber" },
  salon: { he: "מספרה", ar: "صالون شعر", en: "Hair Salon" },
  nails: { he: "ציפורניים", ar: "أظافر", en: "Nails" },
  brows: { he: "גבות וריסים", ar: "حواجب ورموش", en: "Brows & Lashes" },
  spa: { he: "ספא ועיסוי", ar: "سبا ومساج", en: "Spa & Massage" },
  skincare: { he: "טיפוח עור", ar: "العناية بالبشرة", en: "Skincare" },
};

export const providers: Provider[] = [
  {
    id: "1",
    name: { he: "הג׳נטלמן – מספרת גברים", ar: "الجنتلمان – حلاق رجالي", en: "The Gentleman's Cut" },
    category: "barber",
    rating: 4.9,
    reviewCount: 234,
    distance: "0.8",
    image: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1585747860019-8e8e14e0ef66?w=800&h=400&fit=crop",
    address: { he: "רחוב האלון 12, מרכז העיר", ar: "شارع البلوط 12، وسط المدينة", en: "12 Elm Street, Downtown" },
    about: {
      he: "חוויית טיפוח פרימיום עם ספרים מיומנים שמבינים סגנון מודרני וקלאסי. מומלץ להזמין מראש.",
      ar: "تجربة عناية فاخرة مع حلاقين محترفين يفهمون الأساليب الحديثة والكلاسيكية. يُنصح بالحجز مسبقاً.",
      en: "Premium grooming experience with skilled barbers who understand modern and classic styles. Appointments recommended.",
    },
    services: [
      { id: "s1", name: { he: "תספורת קלאסית", ar: "قصة شعر كلاسيكية", en: "Classic Haircut" }, duration: 30, price: 35 },
      { id: "s2", name: { he: "עיצוב זקן", ar: "تشذيب اللحية", en: "Beard Trim" }, duration: 20, price: 20 },
      { id: "s3", name: { he: "גילוח עם מגבת חמה", ar: "حلاقة بالمنشفة الساخنة", en: "Hot Towel Shave" }, duration: 40, price: 45 },
      { id: "s4", name: { he: "תספורת + זקן", ar: "قصة شعر + لحية", en: "Haircut + Beard" }, duration: 45, price: 50 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1503951914875-452d3928e1b0?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–חמישי", ar: "الأحد–الخميس", en: "Sun–Thu" }, hours: "9:00 – 20:00" },
      { day: { he: "שישי", ar: "الجمعة", en: "Friday" }, hours: "9:00 – 14:00" },
      { day: { he: "שבת", ar: "السبت", en: "Saturday" }, hours: "—" },
    ],
    reviews: [
      { name: "Ahmad K.", rating: 5, comment: { he: "הספר הכי טוב בעיר. תמיד יוצא מסודר.", ar: "أفضل حلاق في المدينة. دائماً أخرج بمظهر أنيق.", en: "Best barber in town. Always leaves looking sharp." }, date: { he: "לפני יומיים", ar: "قبل يومين", en: "2 days ago" } },
      { name: "Sara M.", rating: 5, comment: { he: "הבאתי את הבן שלי, היו סבלניים מאוד. תספורת מעולה!", ar: "أحضرت ابني، كانوا صبورين جداً. قصة ممتازة!", en: "Took my son here, they were so patient. Great cut!" }, date: { he: "לפני שבוע", ar: "قبل أسبوع", en: "1 week ago" } },
      { name: "Omar R.", rating: 4, comment: { he: "מקצועיים מאוד. המתנה ארוכה קצת בסופ״ש.", ar: "محترفون جداً. انتظار طويل قليلاً في نهاية الأسبوع.", en: "Very professional. Slightly long wait on weekends." }, date: { he: "לפני שבועיים", ar: "قبل أسبوعين", en: "2 weeks ago" } },
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
