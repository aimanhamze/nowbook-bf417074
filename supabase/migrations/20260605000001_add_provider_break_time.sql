ALTER TABLE provider_availability
  ADD COLUMN IF NOT EXISTS break_start time,
  ADD COLUMN IF NOT EXISTS break_end   time;
