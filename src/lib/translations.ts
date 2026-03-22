export type Lang = "he" | "ar";

export const translations = {
  he: {
    // General
    appName: "Book",
    goodMorning: "בוקר טוב ☀️",
    findAppointment: "מצא את התור",
    nextAppointment: "הבא שלך",
    browseByCategory: "חפש לפי קטגוריה",
    popularNearby: "פופולריים באזור",
    seeAll: "הצג הכל",
    nearby: "בקרבת מקום",
    searchPlaceholder: "חפש שירותים או ספקים...",
    
    // Categories
    barber: "ספר",
    salon: "מספרה",
    nails: "ציפורניים",
    brows: "גבות וריסים",
    spa: "ספא ועיסוי",
    skincare: "טיפוח עור",
    
    // Provider detail
    about: "אודות",
    services: "שירותים",
    hours: "שעות פעילות",
    photos: "תמונות",
    reviews: "ביקורות",
    bookAppointment: "קבע תור",
    min: "דק׳",
    
    // Booking
    bookAt: "קביעת תור ב",
    step: "שלב",
    of: "מתוך",
    selectServices: "בחר שירותים",
    pickTime: "בחר זמן",
    confirm: "אישור",
    selectDate: "בחר תאריך",
    availableTimes: "זמנים פנויים",
    continue: "המשך",
    confirmBooking: "אשר הזמנה",
    provider: "ספק",
    dateTime: "תאריך ושעה",
    total: "סה״כ",
    payAtVenue: "💳 התשלום ייגבה במקום",
    service: "שירות",
    serviceCount: "שירותים",
    
    // Booking confirmed
    bookingConfirmed: "התור אושר!",
    youreAllSet: "הכל מוכן",
    viewMyBookings: "הצג את התורים שלי",
    backToHome: "חזרה לדף הבית",
    
    // Navigation
    home: "בית",
    explore: "חיפוש",
    bookings: "תורים",
    favorites: "מועדפים",
    profile: "פרופיל",
    
    // Explore
    all: "הכל",
    providersFound: "ספקים נמצאו",
    providerFound: "ספק נמצא",
    noProvidersFound: "לא נמצאו ספקים",
    clearFilters: "נקה סינון",
    search: "חיפוש...",
    
    // Bookings page
    myBookings: "התורים שלי",
    noBookingsYet: "אין תורים עדיין",
    bookFirstAppointment: "קבע את התור הראשון שלך כדי לראות אותו כאן",
    exploreServices: "גלה שירותים",
    
    // Favorites
    noFavoritesYet: "אין מועדפים עדיין",
    tapHeart: "לחץ על הלב בספקים שאתה אוהב",
    browseProviders: "חפש ספקים",
    
    // Profile
    guest: "אורח",
    signInToManage: "התחבר כדי לנהל את התורים שלך",
    signInUp: "התחברות / הרשמה",
    notifications: "התראות",
    settings: "הגדרות",
    helpSupport: "עזרה ותמיכה",
    language: "שפה",
    
    // Misc
    closed: "סגור",
    km: "ק״מ",
    noBookingData: "לא נמצאו נתוני הזמנה",
    providerNotFound: "הספק לא נמצא",
  },
  ar: {
    appName: "Book",
    goodMorning: "صباح الخير ☀️",
    findAppointment: "ابحث عن",
    nextAppointment: "موعدك القادم",
    browseByCategory: "تصفح حسب الفئة",
    popularNearby: "الأكثر شعبية بالقرب منك",
    seeAll: "عرض الكل",
    nearby: "بالقرب",
    searchPlaceholder: "ابحث عن خدمات أو مزودين...",
    
    barber: "حلاق",
    salon: "صالون شعر",
    nails: "أظافر",
    brows: "حواجب ورموش",
    spa: "سبا ومساج",
    skincare: "العناية بالبشرة",
    
    about: "حول",
    services: "الخدمات",
    hours: "ساعات العمل",
    photos: "صور",
    reviews: "التقييمات",
    bookAppointment: "احجز موعد",
    min: "دقيقة",
    
    bookAt: "حجز موعد في",
    step: "خطوة",
    of: "من",
    selectServices: "اختر الخدمات",
    pickTime: "اختر الوقت",
    confirm: "تأكيد",
    selectDate: "اختر التاريخ",
    availableTimes: "الأوقات المتاحة",
    continue: "متابعة",
    confirmBooking: "تأكيد الحجز",
    provider: "مزود الخدمة",
    dateTime: "التاريخ والوقت",
    total: "المجموع",
    payAtVenue: "💳 الدفع عند الوصول",
    service: "خدمة",
    serviceCount: "خدمات",
    
    bookingConfirmed: "تم تأكيد الحجز!",
    youreAllSet: "أنت جاهز",
    viewMyBookings: "عرض حجوزاتي",
    backToHome: "العودة للرئيسية",
    
    home: "الرئيسية",
    explore: "استكشاف",
    bookings: "الحجوزات",
    favorites: "المفضلة",
    profile: "الملف الشخصي",
    
    all: "الكل",
    providersFound: "مزودين",
    providerFound: "مزود واحد",
    noProvidersFound: "لم يتم العثور على مزودين",
    clearFilters: "مسح الفلاتر",
    search: "بحث...",
    
    myBookings: "حجوزاتي",
    noBookingsYet: "لا توجد حجوزات بعد",
    bookFirstAppointment: "احجز أول موعد لك لتراه هنا",
    exploreServices: "استكشف الخدمات",
    
    noFavoritesYet: "لا توجد مفضلات بعد",
    tapHeart: "اضغط على القلب على المزودين الذين تحبهم",
    browseProviders: "تصفح المزودين",
    
    guest: "زائر",
    signInToManage: "سجل دخولك لإدارة حجوزاتك",
    signInUp: "تسجيل الدخول / إنشاء حساب",
    notifications: "الإشعارات",
    settings: "الإعدادات",
    helpSupport: "المساعدة والدعم",
    language: "اللغة",
    
    closed: "مغلق",
    km: "كم",
    noBookingData: "لم يتم العثور على بيانات الحجز",
    providerNotFound: "لم يتم العثور على المزود",
  },
} as const;

export type TranslationKey = keyof typeof translations.he;
