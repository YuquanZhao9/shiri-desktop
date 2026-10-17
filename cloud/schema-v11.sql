-- 昱时 云同步第 11 版：每天测体重。在 schema-v10.sql 之后运行一次（可重复运行）。
-- 体重记录也放在 shiri_weekly（kind = 'weight'，payload 同 src/types.ts 的 WeightEntry，id = weight_<yyyymmdd>）。

begin;

alter table public.shiri_weekly drop constraint if exists shiri_weekly_kind;
alter table public.shiri_weekly add constraint shiri_weekly_kind check (kind in ('goal', 'mark', 'class', 'weight'));

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
    if kind not in ('goal', 'mark', 'class', 'weight') or pg_catalog.jsonb_typeof(item) is distinct from 'object'
       or item->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
       or item->>'createdAt' !~ stamp_pattern or item->>'updatedAt' !~ stamp_pattern
       or (item ? 'deletedAt' and item->>'deletedAt' !~ stamp_pattern)
       or (kind = 'goal' and (pg_catalog.jsonb_typeof(item->'name') is distinct from 'string'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'name', 'color', 'target', 'slots', 'duration', 'time', 'earliest', 'latest', 'days', 'createdAt', 'updatedAt', 'deletedAt'))))
       or (kind = 'mark' and (item->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or item->>'goalId' !~ '^[A-Za-z0-9_-]{1,128}$'
            or pg_catalog.jsonb_typeof(item->'done') is distinct from 'boolean'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'goalId', 'date', 'done', 'time', 'duration', 'auto', 'createdAt', 'updatedAt', 'deletedAt'))))
       or (kind = 'weight' and (item->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or pg_catalog.jsonb_typeof(item->'kg') is distinct from 'number'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'date', 'kg', 'createdAt', 'updatedAt', 'deletedAt'))))
       or (kind = 'class' and (item->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or item->>'slotId' !~ '^[A-Za-z0-9_-]{1,64}$'
            or item->>'status' not in ('done', 'todo', 'review')
            or pg_catalog.jsonb_typeof(item->'note') is distinct from 'string' or pg_catalog.jsonb_typeof(item->'title') is distinct from 'string'
            or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'slotId', 'date', 'title', 'status', 'note', 'createdAt', 'updatedAt', 'deletedAt')))) then
      raise exception 'Invalid weekly item' using errcode = '22023';
    end if;
    changed_at := greatest((item->>'updatedAt')::timestamptz, coalesce((item->>'deletedAt')::timestamptz, '-infinity'::timestamptz));
    insert into public.shiri_weekly as stored (user_id, id, kind, day, payload, updated_at, deleted)
      values (current_user_id, item->>'id', kind, case when kind in ('mark', 'class', 'weight') then (item->>'date')::date end, item, changed_at, item ? 'deletedAt')
    on conflict (user_id, id) do update
      set kind = excluded.kind, day = excluded.day, payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted
      where excluded.updated_at > stored.updated_at
         or (excluded.updated_at = stored.updated_at and excluded.deleted and not stored.deleted);
  end loop;
end;
$$;

revoke all on function public.merge_weekly(jsonb, uuid) from public, anon;
grant execute on function public.merge_weekly(jsonb, uuid) to authenticated;

-- 每天 08:00 还没记体重就推送（shiri-reminders 读取）；手机“我的 → 日程提醒”里可关。
alter table public.shiri_push_subscriptions add column if not exists weight_reminder boolean not null default true;

commit;
