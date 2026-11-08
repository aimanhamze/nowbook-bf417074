// Hebrew category labels for the admin dialogs, as CreateProviderDialog
// always had them. Shared by CreateProviderDialog, CreateBranchDialog and
// EditProviderDialog.
//
// This map is ALSO the admin's list of categories (ADMIN_CATEGORY_IDS below).
// It may run ahead of the customer-facing `categories` in mock-data (that is
// how academy was introduced: admin-only first, customer-visible in Phase 3);
// today the two lists hold the same ids.
export const categoryLabels: Record<string, string> = {
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
  counseling: "💬 ייעוץ והדרכות",
  piercing: "💎 פירסינג",
  academy: "🎓 אקדמיה וקורסים",
};

/** Category ids offered in the admin dialogs, in label order. */
export const ADMIN_CATEGORY_IDS: readonly string[] = Object.keys(categoryLabels);
