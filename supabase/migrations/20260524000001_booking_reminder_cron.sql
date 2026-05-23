-- Schedule booking-reminder edge function every 15 minutes via pg_cron + pg_net
SELECT cron.schedule(
  'booking-reminder-every-15min',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://aqlcjjrgsxispdjwrnqf.supabase.co/functions/v1/booking-reminder',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxbGNqanJnc3hpc3BkandybnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDQzMjgsImV4cCI6MjA5MTMyMDMyOH0.Ct4HFodiHevIs0BC0EGt8b5TG8ReKLilDinyXUlgmuw"}'::jsonb,
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);
