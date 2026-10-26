-- 昱时 云同步第 7 版：周次任务。在 schema-v6.sql 之后运行一次（可重复运行）。
-- 任务（kind=goal，payload 同 src/types.ts WeeklyGoal）和打卡（kind=mark，payload 同 GoalMark）每条一行；
-- 较新的为准，时间相同删除优先（同 src/weekly.ts newerItem）。

begin;

create table if not exists public.shiri_weekly (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  kind text not null,
  day date,
  payload jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  primary key (user_id, id),
  constraint shiri_weekly_kind check (kind in ('goal', 'mark')),
  constraint shiri_weekly_id check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  constraint shiri_weekly_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_weekly_size check (octet_length(payload::text) < 4000)
);
create index if not exists shiri_weekly_user_day on public.shiri_weekly (user_id, day);

alter table public.shiri_weekly enable row level security;
alter table public.shiri_weekly replica identity full;
revoke all on table public.shiri_weekly from anon, authenticated;
grant select, insert, update, delete on table public.shiri_weekly to authenticated;

drop policy if exists shiri_weekly_select_own on public.shiri_weekly;
create policy shiri_weekly_select_own on public.shiri_weekly for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_weekly_insert_own on public.shiri_weekly;
create policy shiri_weekly_insert_own on public.shiri_weekly for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_weekly_update_own on public.shiri_weekly;
create policy shiri_weekly_update_own on public.shiri_weekly for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_weekly_delete_own on public.shiri_weekly;
create policy shiri_weekly_delete_own on public.shiri_weekly for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_weekly'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_weekly';
  end if;
end;
$$;

-- incoming：[{ kind: 'goal' | 'mark', item: {...} }]
create or replace function public.merge_weekly(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  entry jsonb;
  item jsonb;
  kind text;
  changed_at timestamptz;
  stamp_pattern constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$';
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'array' or pg_catalog.jsonb_array_length(incoming) > 500 then
    raise exception 'Invalid weekly payload' using errcode = '22023';
  end if;
  for entry in select value from pg_catalog.jsonb_array_elements(incoming) loop
    kind := entry->>'kind';
    item := entry->'item';
    if kind not in ('goal', 'mark') or pg_catalog.jsonb_typeof(item) is distinct from 'object'
       or item->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
       or item->>'createdAt' !~ stamp_pattern or item->>'updatedAt' !~ stamp_pattern
       or (item ? 'deletedAt' and item->>'deletedAt' !~ stamp_pattern)
       or (kind = 'goal' and (pg_catalog.jsonb_typeof(item->'name') is distinct from 'string'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'name', 'color', 'target', 'slots', 'createdAt', 'updatedAt', 'deletedAt'))))
       or (kind = 'mark' and (item->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or item->>'goalId' !~ '^[A-Za-z0-9_-]{1,128}$'
            or pg_catalog.jsonb_typeof(item->'done') is distinct from 'boolean'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'goalId', 'date', 'done', 'createdAt', 'updatedAt', 'deletedAt')))) then
      raise exception 'Invalid weekly item' using errcode = '22023';
    end if;
    changed_at := greatest((item->>'updatedAt')::timestamptz, coalesce((item->>'deletedAt')::timestamptz, '-infinity'::timestamptz));
    insert into public.shiri_weekly as stored (user_id, id, kind, day, payload, updated_at, deleted)
      values (current_user_id, item->>'id', kind, case when kind = 'mark' then (item->>'date')::date end, item, changed_at, item ? 'deletedAt')
    on conflict (user_id, id) do update
      set kind = excluded.kind, day = excluded.day, payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted
      where excluded.updated_at > stored.updated_at
         or (excluded.updated_at = stored.updated_at and excluded.deleted and not stored.deleted);
  end loop;
end;
$$;

revoke all on function public.merge_weekly(jsonb, uuid) from public, anon;
grant execute on function public.merge_weekly(jsonb, uuid) to authenticated;

-- 周五 19:00 周次任务还差 2 次及以上时推送（shiri-reminders 读取）；手机“我的 → 日程提醒”里可关。
alter table public.shiri_push_subscriptions add column if not exists goal_reminder boolean not null default true;

commit;
