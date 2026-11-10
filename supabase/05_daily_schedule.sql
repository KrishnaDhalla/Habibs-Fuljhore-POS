-- Optional: the morning Telegram message at 9:00 every day (India time), even on a day nobody opens the app,
-- and the automatic WhatsApp messages every 30 minutes (see the end of this file).
-- It carries leave today and tomorrow, leave waiting for your answer, today's bookings, who didn't check in, on Mondays
-- everyone's leave this week, and the planning messages for leave coming up (7, 3 and 1 days before).
-- Without this file the same message goes the first time the app is opened each day.
--
-- 1. Supabase → Database → Extensions: turn on pg_cron and pg_net.
-- 2. Supabase → Edge Functions → Secrets: add CRON_SECRET = a long random text (e.g. from a password generator).
--    Both functions (login-approval and whatsapp) read it.
-- 3. Below, put your project's URL (Settings → API → Project URL) and the same CRON_SECRET, then run this file once
--    in the SQL editor. Running it again replaces the old values.
-- To stop it: select cron.unschedule('habibs-morning');

do $$ begin
  delete from vault.secrets where name in ('habibs_project_url', 'habibs_cron_secret');
end $$;
select vault.create_secret('https://YOUR-PROJECT-ID.supabase.co', 'habibs_project_url');
select vault.create_secret('PASTE-THE-SAME-CRON_SECRET-HERE', 'habibs_cron_secret');

-- 03:30 UTC = 9:00 in India, every day
select cron.schedule('habibs-morning', '30 3 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'habibs_project_url') || '/functions/v1/login-approval',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'habibs_cron_secret')),
    body    := '{"action": "day"}'::jsonb
  );
$job$);

-- The automatic WhatsApp messages (feedback after a visit, booking reminders, "we miss you"): every 30 minutes.
-- The function itself sends nothing between 9 pm and 9 am. Without this job they go while the app is open on a
-- tablet (it asks every 20 minutes). To stop it: select cron.unschedule('habibs-whatsapp');
select cron.schedule('habibs-whatsapp', '*/30 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'habibs_project_url') || '/functions/v1/whatsapp',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'habibs_cron_secret')),
    body    := '{"action": "auto"}'::jsonb
  );
$job$);

-- Check: the job is there, and (the next morning) that it ran
select jobname, schedule, active from cron.job where jobname in ('habibs-morning', 'habibs-whatsapp');
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
