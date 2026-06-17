-- WhatsApp message template columns for provider_profiles
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS deposit_message_template text,
  ADD COLUMN IF NOT EXISTS reminder_message_template text;

-- Backfill defaults for existing providers
UPDATE provider_profiles
SET deposit_message_template = 'שלום {customer_name} 😊
קיבלנו את בקשת התור שלך ל{service_name} בתאריך {date} בשעה {time}.
לאישור התור נדרש תשלום מקדמה של ₪{price}.'
WHERE deposit_message_template IS NULL;

UPDATE provider_profiles
SET reminder_message_template = 'שלום {customer_name} 😊
רצינו להזכיר לך את התור שקבעת אצלנו:
📅 תאריך: {date}
⏰ שעה: {time}
💇 שירות: {service_name}
מצפים לראותך! 🙏'
WHERE reminder_message_template IS NULL;
