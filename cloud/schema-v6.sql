-- 昱时 云同步第 6 版：复盘（感悟）。在 schema-v5.sql 之后运行一次（可重复运行）。
-- 每条一行，payload 与 src/types.ts 的 Reflection 相同；较新的为准，时间相同删除优先（同 src/reflections.ts newerReflection）。

begin;

create table if not exists public.shiri_reflections (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  day date not null,
  payload jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  primary key (user_id, id),
  constraint shiri_reflections_id check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  constraint shiri_reflections_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_reflections_size check (octet_length(payload::text) < 40000)
);
create index if not exists shiri_reflections_user_day on public.shiri_reflections (user_id, day);

alter table public.shiri_reflections enable row level security;
alter table public.shiri_reflections replica identity full;
revoke all on table public.shiri_reflections from anon, authenticated;
grant select, insert, update, delete on table public.shiri_reflections to authenticated;

drop policy if exists shiri_reflections_select_own on public.shiri_reflections;
create policy shiri_reflections_select_own on public.shiri_reflections for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_reflections_insert_own on public.shiri_reflections;
create policy shiri_reflections_insert_own on public.shiri_reflections for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_reflections_update_own on public.shiri_reflections;
create policy shiri_reflections_update_own on public.shiri_reflections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_reflections_delete_own on public.shiri_reflections;
create policy shiri_reflections_delete_own on public.shiri_reflections for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_reflections'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_reflections';
  end if;
end;
$$;

create or replace function public.merge_reflections(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  item jsonb;
  changed_at timestamptz;
  stamp_pattern constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$';
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'array' or pg_catalog.jsonb_array_length(incoming) > 500 then
    raise exception 'Invalid reflections payload' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(incoming) loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
       or item->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
       or item->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
       or pg_catalog.jsonb_typeof(item->'text') is distinct from 'string'
       or item->>'createdAt' !~ stamp_pattern
       or item->>'updatedAt' !~ stamp_pattern
       or (item ? 'deletedAt' and item->>'deletedAt' !~ stamp_pattern)
       or exists (select 1 from pg_catalog.jsonb_object_keys(item) as k(key) where k.key not in ('id', 'date', 'text', 'createdAt', 'updatedAt', 'deletedAt')) then
      raise exception 'Invalid reflection' using errcode = '22023';
    end if;
    changed_at := greatest((item->>'updatedAt')::timestamptz, coalesce((item->>'deletedAt')::timestamptz, '-infinity'::timestamptz));
    insert into public.shiri_reflections as stored (user_id, id, day, payload, updated_at, deleted)
      values (current_user_id, item->>'id', (item->>'date')::date, item, changed_at, item ? 'deletedAt')
    on conflict (user_id, id) do update
      set day = excluded.day, payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted
      where excluded.updated_at > stored.updated_at
         or (excluded.updated_at = stored.updated_at and excluded.deleted and not stored.deleted);
  end loop;
end;
$$;

revoke all on function public.merge_reflections(jsonb, uuid) from public, anon;
grant execute on function public.merge_reflections(jsonb, uuid) to authenticated;

-- 每周日 20:00 提醒看本周复盘汇总（shiri-reminders 读取）；手机“我的 → 日程提醒”里可关。
alter table public.shiri_push_subscriptions add column if not exists review_reminder boolean not null default true;

commit;
