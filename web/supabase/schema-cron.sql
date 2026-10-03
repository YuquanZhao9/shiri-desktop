-- 昱时 提醒定时器：每分钟调用一次云函数 shiri-reminders。
-- 运行前把 PROJECT_REF 换成项目 ID（网址 https://PROJECT_REF.supabase.co 里的那段），
-- CRON_SECRET 换成部署函数时设置的同一个随机串。可重复运行。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'shiri-reminders';

select cron.schedule(
  'shiri-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/shiri-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
