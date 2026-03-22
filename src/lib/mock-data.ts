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
  barber: { he: "ספר", ar: "حلاق" },
  salon: { he: "מספרה", ar: "صالون شعر" },
  nails: { he: "ציפורניים", ar: "أظافر" },
  brows: { he: "גבות וריסים", ar: "حواجب ورموش" },
  spa: { he: "ספא ועיסוי", ar: "سبا ومساج" },
  skincare: { he: "טיפוח עור", ar: "العناية بالبشرة" },
};

export const providers: Provider[] = [
  {
    id: "1",
    name: { he: "הג׳נטלמן – מספרת גברים", ar: "الجنتلمان – حلاق رجالي" },
    category: "barber",
    rating: 4.9,
    reviewCount: 234,
    distance: "0.8",
    image: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1585747860019-8e8e14e0ef66?w=800&h=400&fit=crop",
    address: { he: "רחוב האלון 12, מרכז העיר", ar: "شارع البلوط 12، وسط المدينة" },
    about: {
      he: "חוויית טיפוח פרימיום עם ספרים מיומנים שמבינים סגנון מודרני וקלאסי. מומלץ להזמין מראש.",
      ar: "تجربة عناية فاخرة مع حلاقين محترفين يفهمون الأساليب الحديثة والكلاسيكية. يُنصح بالحجز مسبقاً.",
    },
    services: [
      { id: "s1", name: { he: "תספורת קלאסית", ar: "قصة شعر كلاسيكية" }, duration: 30, price: 35 },
      { id: "s2", name: { he: "עיצוב זקן", ar: "تشذيب اللحية" }, duration: 20, price: 20 },
      { id: "s3", name: { he: "גילוח עם מגבת חמה", ar: "حلاقة بالمنشفة الساخنة" }, duration: 40, price: 45 },
      { id: "s4", name: { he: "תספורת + זקן", ar: "قصة شعر + لحية" }, duration: 45, price: 50 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1503951914875-452d3928e1b0?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–חמישי", ar: "الأحد–الخميس" }, hours: "9:00 – 20:00" },
      { day: { he: "שישי", ar: "الجمعة" }, hours: "9:00 – 14:00" },
      { day: { he: "שבת", ar: "السبت" }, hours: "—" },
    ],
    reviews: [
      { name: "אחמד כ.", rating: 5, comment: { he: "הספר הכי טוב בעיר. תמיד יוצא מסודר.", ar: "أفضل حلاق في المدينة. دائماً أخرج بمظهر أنيق." }, date: { he: "לפני יומיים", ar: "قبل يومين" } },
      { name: "שרה מ.", rating: 5, comment: { he: "הבאתי את הבן שלי, היו סבלניים מאוד. תספורת מעולה!", ar: "أحضرت ابني، كانوا صبورين جداً. قصة ممتازة!" }, date: { he: "לפני שבוע", ar: "قبل أسبوع" } },
      { name: "עומר ר.", rating: 4, comment: { he: "מקצועיים מאוד. המתנה ארוכה קצת בסופ״ש.", ar: "محترفون جداً. انتظار طويل قليلاً في نهاية الأسبوع." }, date: { he: "לפני שבועיים", ar: "قبل أسبوعين" } },
    ],
  },
  {
    id: "2",
    name: { he: "בלום ביוטי סטודיו", ar: "بلوم بيوتي ستوديو" },
    category: "salon",
    rating: 4.8,
    reviewCount: 189,
    distance: "1.2",
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&h=400&fit=crop",
    address: { he: "שדרות הוורדים 45, מרכז", ar: "شارع الورود 45، المركز" },
    about: {
      he: "סטודיו יופי מלא עם תספורות, צבע, עיצוב וטיפולים באווירה מרגיעה.",
      ar: "ستوديو تجميل متكامل يقدم قص شعر وصبغات وتصفيف وعلاجات في أجواء مريحة.",
    },
    services: [
      { id: "s5", name: { he: "תספורת נשים", ar: "قصة شعر نسائية" }, duration: 45, price: 55 },
      { id: "s6", name: { he: "פן ועיצוב", ar: "تجفيف وتصفيف" }, duration: 30, price: 40 },
      { id: "s7", name: { he: "צבע מלא", ar: "صبغة كاملة" }, duration: 90, price: 120 },
      { id: "s8", name: { he: "הייליטס", ar: "هايلايت" }, duration: 120, price: 150 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–חמישי", ar: "الأحد–الخميس" }, hours: "10:00 – 19:00" },
      { day: { he: "שישי", ar: "الجمعة" }, hours: "10:00 – 14:00" },
      { day: { he: "שבת", ar: "السبت" }, hours: "—" },
    ],
    reviews: [
      { name: "לילה ח.", rating: 5, comment: { he: "הסלון הקבוע שלי! צבע מדהים.", ar: "صالوني المفضل! لون رائع." }, date: { he: "לפני 3 ימים", ar: "قبل 3 أيام" } },
      { name: "נור א.", rating: 5, comment: { he: "סטודיו יפהפה וצוות נעים.", ar: "ستوديو جميل وطاقم لطيف." }, date: { he: "לפני שבוע", ar: "قبل أسبوع" } },
    ],
  },
  {
    id: "3",
    name: { he: "פוליש – ציפורניים", ar: "بوليش – أظافر" },
    category: "nails",
    rating: 4.7,
    reviewCount: 156,
    distance: "0.5",
    image: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=800&h=400&fit=crop",
    address: { he: "סמטת הארז 8, מערב", ar: "زقاق الأرز 8، الغرب" },
    about: {
      he: "מומחיות לנייל ארט עם ג׳ל, אקריל ומניקור/פדיקור קלאסי עם מוצרים פרימיום.",
      ar: "متخصصات في فن الأظافر مع جل وأكريليك ومانيكير/بديكير كلاسيكي بمنتجات فاخرة.",
    },
    services: [
      { id: "s9", name: { he: "מניקור קלאסי", ar: "مانيكير كلاسيكي" }, duration: 30, price: 25 },
      { id: "s10", name: { he: "מניקור ג׳ל", ar: "مانيكير جل" }, duration: 45, price: 40 },
      { id: "s11", name: { he: "פדיקור קלאסי", ar: "بديكير كلاسيكي" }, duration: 40, price: 35 },
      { id: "s12", name: { he: "סט אקריל מלא", ar: "طقم أكريليك كامل" }, duration: 60, price: 65 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–שבת", ar: "الأحد–السبت" }, hours: "9:00 – 19:00" },
    ],
    reviews: [
      { name: "דינה פ.", rating: 5, comment: { he: "נייל ארט מדהים! באמת שמים לב לפרטים.", ar: "فن أظافر مذهل! يهتمون حقاً بالتفاصيل." }, date: { he: "לפני 5 ימים", ar: "قبل 5 أيام" } },
    ],
  },
  {
    id: "4",
    name: { he: "ארץ׳ אנד גלואו – גבות וריסים", ar: "آرتش أند جلو – حواجب ورموش" },
    category: "brows",
    rating: 4.9,
    reviewCount: 312,
    distance: "1.8",
    image: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d946?w=800&h=400&fit=crop",
    address: { he: "שדרות הפארק 22", ar: "شارع الحديقة 22" },
    about: {
      he: "מומחיות לגבות וריסים. מיקרובליידינג, למינציה, הארכות ריסים ועוד.",
      ar: "متخصصات في الحواجب والرموش. مايكروبلايدنج، تصفيح، وصلات رموش والمزيد.",
    },
    services: [
      { id: "s13", name: { he: "שעווה לגבות", ar: "تشكيل حواجب بالخيط" }, duration: 15, price: 18 },
      { id: "s14", name: { he: "למינציית גבות", ar: "تصفيح حواجب" }, duration: 45, price: 55 },
      { id: "s15", name: { he: "הארכת ריסים מלאה", ar: "وصلات رموش كاملة" }, duration: 90, price: 95 },
      { id: "s16", name: { he: "ליפט + צבע לריסים", ar: "رفع رموش + صبغة" }, duration: 60, price: 70 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "שני–שבת", ar: "الاثنين–السبت" }, hours: "10:00 – 19:00" },
      { day: { he: "ראשון", ar: "الأحد" }, hours: "—" },
    ],
    reviews: [
      { name: "רים ש.", rating: 5, comment: { he: "הגבות הכי טובות בעיר. נקודה.", ar: "أفضل حواجب في المدينة. نقطة." }, date: { he: "אתמול", ar: "أمس" } },
      { name: "הנא ת.", rating: 5, comment: { he: "הארכות הריסים שלי החזיקו 4 שבועות! מדהים.", ar: "وصلات رموشي استمرت 4 أسابيع! مذهل." }, date: { he: "לפני שבוע", ar: "قبل أسبوع" } },
    ],
  },
  {
    id: "5",
    name: { he: "סרניטי ספא", ar: "سيرينيتي سبا" },
    category: "spa",
    rating: 4.8,
    reviewCount: 98,
    distance: "2.3",
    image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=800&h=400&fit=crop",
    address: { he: "דרך הבריאות 100", ar: "طريق العافية 100" },
    about: {
      he: "מפלט שליו עם עיסויים טיפוליים, טיפולי פנים וטיפולי גוף עם מוצרים אורגניים.",
      ar: "ملاذ هادئ يقدم مساج علاجي وعلاجات وجه وجسم بمنتجات عضوية.",
    },
    services: [
      { id: "s17", name: { he: "עיסוי שוודי (60 דק׳)", ar: "مساج سويدي (60 دقيقة)" }, duration: 60, price: 85 },
      { id: "s18", name: { he: "עיסוי רקמות עמוקות", ar: "مساج الأنسجة العميقة" }, duration: 60, price: 95 },
      { id: "s19", name: { he: "טיפול פנים סיגנצ׳ר", ar: "علاج وجه مميز" }, duration: 50, price: 75 },
      { id: "s20", name: { he: "טיפול אבנים חמות", ar: "علاج الحجر الساخن" }, duration: 75, price: 110 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: { he: "ראשון–שבת", ar: "الأحد–السبت" }, hours: "9:00 – 21:00" },
    ],
    reviews: [
      { name: "יסמין ב.", rating: 5, comment: { he: "גן עדן עלי אדמות. אחזור כל חודש.", ar: "جنة على الأرض. سأعود كل شهر." }, date: { he: "לפני 3 ימים", ar: "قبل 3 أيام" } },
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
