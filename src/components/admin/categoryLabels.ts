// Hebrew category labels for the admin dialogs, as CreateProviderDialog
// always had them. Shared by CreateProviderDialog, CreateBranchDialog and
// EditProviderDialog.
//
// This map is ALSO the admin's list of categories (ADMIN_CATEGORY_IDS below),
// and it is deliberately a superset of the customer-facing `categories` in
// mock-data: `academy` lives here so an admin can create an academy provider
// while Home/Explore do not show the category yet (academy Phase 3).
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
