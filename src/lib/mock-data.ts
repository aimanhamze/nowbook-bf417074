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
  {
    id: "2",
    name: { he: "בלום ביוטי סטודיו", ar: "بلوم بيوتي ستوديو", en: "Bloom Beauty Studio" },
    category: "salon",
    rating: 4.8,
    reviewCount: 189,
    distance: "1.2",
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&h=400&fit=crop",
    address: { he: "שדרות הוורדים 45, מרכז", ar: "شارع الورود 45، المركز", en: "45 Rose Avenue, Midtown" },
    about: {
      he: "סטודיו יופי מלא עם תספורות, צבע, עיצוב וטיפולים באווירה מרגיעה.",
      ar: "ستوديو تجميل متكامل يقدم قص شعر وصبغات وتصفيف وعلاجات في أجواء مريحة.",
      en: "A full-service beauty studio offering haircuts, coloring, styling, and treatments in a relaxing atmosphere.",
    },
    services: [
      { id: "s5", name: { he: "תספורת נשים", ar: "قصة شعر نسائية", en: "Women's Haircut" }, duration: 45, price: 55 },
      { id: "s6", name: { he: "פן ועיצוב", ar: "تجفيف وتصفيف", en: "Blowout & Style" }, duration: 30, price: 40 },
      { id: "s7", name: { he: "צבע מלא", ar: "صبغة كاملة", en: "Full Color" }, duration: 90, price: 120 },
      { id: "s8", name: { he: "הייליטס", ar: "هايلايت", en: "Highlights" }, duration: 120, price: 150 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–חמישי", ar: "الأحد–الخميس", en: "Sun–Thu" }, hours: "10:00 – 19:00" },
      { day: { he: "שישי", ar: "الجمعة", en: "Friday" }, hours: "10:00 – 14:00" },
      { day: { he: "שבת", ar: "السبت", en: "Saturday" }, hours: "—" },
    ],
    reviews: [
      { name: "Layla H.", rating: 5, comment: { he: "הסלון הקבוע שלי! צבע מדהים.", ar: "صالوني المفضل! لون رائع.", en: "My go-to salon! Amazing color work." }, date: { he: "לפני 3 ימים", ar: "قبل 3 أيام", en: "3 days ago" } },
      { name: "Noor A.", rating: 5, comment: { he: "סטודיו יפהפה וצוות נעים.", ar: "ستوديو جميل وطاقم لطيف.", en: "Beautiful studio and lovely staff." }, date: { he: "לפני שבוע", ar: "قبل أسبوع", en: "1 week ago" } },
    ],
  },
  {
    id: "3",
    name: { he: "פוליש – ציפורניים", ar: "بوليش – أظافر", en: "Polished Nails & Co" },
    category: "nails",
    rating: 4.7,
    reviewCount: 156,
    distance: "0.5",
    image: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=800&h=400&fit=crop",
    address: { he: "סמטת הארז 8, מערב", ar: "زقاق الأرز 8، الغرب", en: "8 Cedar Lane, West Side" },
    about: {
      he: "מומחיות לנייל ארט עם ג׳ל, אקריל ומניקור/פדיקור קלאסי עם מוצרים פרימיום.",
      ar: "متخصصات في فن الأظافر مع جل وأكريليك ومانيكير/بديكير كلاسيكي بمنتجات فاخرة.",
      en: "Nail art specialists offering gel, acrylic, and classic manicure/pedicure with premium products.",
    },
    services: [
      { id: "s9", name: { he: "מניקור קלאסי", ar: "مانيكير كلاسيكي", en: "Classic Manicure" }, duration: 30, price: 25 },
      { id: "s10", name: { he: "מניקור ג׳ל", ar: "مانيكير جل", en: "Gel Manicure" }, duration: 45, price: 40 },
      { id: "s11", name: { he: "פדיקור קלאסי", ar: "بديكير كلاسيكي", en: "Classic Pedicure" }, duration: 40, price: 35 },
      { id: "s12", name: { he: "סט אקריל מלא", ar: "طقم أكريليك كامل", en: "Full Set Acrylic" }, duration: 60, price: 65 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–שבת", ar: "الأحد–السبت", en: "Sun–Sat" }, hours: "9:00 – 19:00" },
    ],
    reviews: [
      { name: "Dina F.", rating: 5, comment: { he: "נייל ארט מדהים! באמת שמים לב לפרטים.", ar: "فن أظافر مذهل! يهتمون حقاً بالتفاصيل.", en: "Incredible nail art! They really care about detail." }, date: { he: "לפני 5 ימים", ar: "قبل 5 أيام", en: "5 days ago" } },
    ],
  },
];
    name: { he: "ארץ׳ אנד גלואו – גבות וריסים", ar: "آرتش أند جلو – حواجب ورموش", en: "Arch & Glow" },
    category: "brows",
    rating: 4.9,
    reviewCount: 312,
    distance: "1.8",
    image: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d946?w=800&h=400&fit=crop",
    address: { he: "שדרות הפארק 22", ar: "شارع الحديقة 22", en: "22 Park Boulevard" },
    about: {
      he: "מומחיות לגבות וריסים. מיקרובליידינג, למינציה, הארכות ריסים ועוד.",
      ar: "متخصصات في الحواجب والرموش. مايكروبلايدنج، تصفيح، وصلات رموش والمزيد.",
      en: "Brow and lash specialists. Microblading, lamination, lash extensions and more.",
    },
    services: [
      { id: "s13", name: { he: "שעווה לגבות", ar: "تشكيل حواجب بالخيط", en: "Brow Threading" }, duration: 15, price: 18 },
      { id: "s14", name: { he: "למינציית גבות", ar: "تصفيح حواجب", en: "Brow Lamination" }, duration: 45, price: 55 },
      { id: "s15", name: { he: "הארכת ריסים מלאה", ar: "وصلات رموش كاملة", en: "Full Lash Extensions" }, duration: 90, price: 95 },
      { id: "s16", name: { he: "ליפט + צבע לריסים", ar: "رفع رموش + صبغة", en: "Lash Lift & Tint" }, duration: 60, price: 70 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "שני–שבת", ar: "الاثنين–السبت", en: "Mon–Sat" }, hours: "10:00 – 19:00" },
      { day: { he: "ראשון", ar: "الأحد", en: "Sunday" }, hours: "—" },
    ],
    reviews: [
      { name: "Reem S.", rating: 5, comment: { he: "הגבות הכי טובות בעיר. נקודה.", ar: "أفضل حواجب في المدينة. نقطة.", en: "Best brows in the city. Period." }, date: { he: "אתמול", ar: "أمس", en: "Yesterday" } },
      { name: "Hana T.", rating: 5, comment: { he: "הארכות הריסים שלי החזיקו 4 שבועות! מדהים.", ar: "وصلات رموشي استمرت 4 أسابيع! مذهل.", en: "My lash extensions lasted 4 weeks! Amazing." }, date: { he: "לפני שבוע", ar: "قبل أسبوع", en: "1 week ago" } },
    ],
  },
  {
    id: "5",
    name: { he: "סרניטי ספא", ar: "سيرينيتي سبا", en: "Serenity Spa" },
    category: "spa",
    rating: 4.8,
    reviewCount: 98,
    distance: "2.3",
    image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=800&h=400&fit=crop",
    address: { he: "דרך הבריאות 100", ar: "طريق العافية 100", en: "100 Wellness Drive" },
    about: {
      he: "מפלט שליו עם עיסויים טיפוליים, טיפולי פנים וטיפולי גוף עם מוצרים אורגניים.",
      ar: "ملاذ هادئ يقدم مساج علاجي وعلاجات وجه وجسم بمنتجات عضوية.",
      en: "A tranquil escape offering therapeutic massages, facials, and body treatments with organic products.",
    },
    services: [
      { id: "s17", name: { he: "עיסוי שוודי (60 דק׳)", ar: "مساج سويدي (60 دقيقة)", en: "Swedish Massage (60 min)" }, duration: 60, price: 85 },
      { id: "s18", name: { he: "עיסוי רקמות עמוקות", ar: "مساج الأنسجة العميقة", en: "Deep Tissue Massage" }, duration: 60, price: 95 },
      { id: "s19", name: { he: "טיפול פנים סיגנצ׳ר", ar: "علاج وجه مميز", en: "Signature Facial" }, duration: 50, price: 75 },
      { id: "s20", name: { he: "טיפול אבנים חמות", ar: "علاج الحجر الساخن", en: "Hot Stone Therapy" }, duration: 75, price: 110 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–שבת", ar: "الأحد–السبت", en: "Sun–Sat" }, hours: "9:00 – 21:00" },
    ],
    reviews: [
      { name: "Yasmin B.", rating: 5, comment: { he: "גן עדן עלי אדמות. אחזור כל חודש.", ar: "جنة على الأرض. سأعود كل شهر.", en: "Heaven on earth. Will be back every month." }, date: { he: "לפני 3 ימים", ar: "قبل 3 أيام", en: "3 days ago" } },
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
