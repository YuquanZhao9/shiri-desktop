-- 昱时 云同步第 3 版：课表。在 schema-v2.sql 之后运行一次（可重复运行）。
-- 每个账号一行，payload 与 src/types.ts 的 Timetable 相同；较新的 updatedAt 为准（同 src/timetable.ts newerTimetable）。
-- 日程的颜色标签（Task.color）已随 shiri_tasks.payload 同步，无需改表。

begin;

create table if not exists public.shiri_timetable (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null,
  constraint shiri_timetable_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_timetable_size check (octet_length(payload::text) < 200000)
);

alter table public.shiri_timetable enable row level security;
alter table public.shiri_timetable replica identity full;
revoke all on table public.shiri_timetable from anon, authenticated;
grant select, insert, update, delete on table public.shiri_timetable to authenticated;

drop policy if exists shiri_timetable_select_own on public.shiri_timetable;
create policy shiri_timetable_select_own on public.shiri_timetable for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_timetable_insert_own on public.shiri_timetable;
create policy shiri_timetable_insert_own on public.shiri_timetable for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_timetable_update_own on public.shiri_timetable;
create policy shiri_timetable_update_own on public.shiri_timetable for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_timetable_delete_own on public.shiri_timetable;
create policy shiri_timetable_delete_own on public.shiri_timetable for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_timetable'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_timetable';
  end if;
end;
$$;

-- 只有比云端新的课表才会写入；同一时间戳按文本大小决出，两端结果一致。
create or replace function public.merge_timetable(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed_at timestamptz;
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'object'
     or pg_catalog.jsonb_typeof(incoming->'slots') is distinct from 'array'
     or pg_catalog.jsonb_typeof(incoming->'courses') is distinct from 'array'
     or incoming->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then
    raise exception 'Invalid timetable payload' using errcode = '22023';
  end if;
  changed_at := (incoming->>'updatedAt')::timestamptz;

  insert into public.shiri_timetable as stored (user_id, payload, updated_at)
    values (current_user_id, incoming, changed_at)
  on conflict (user_id) do update
    set payload = excluded.payload, updated_at = excluded.updated_at
    where excluded.updated_at > stored.updated_at
       or (excluded.updated_at = stored.updated_at and excluded.payload::text collate "C" > stored.payload::text collate "C");
end;
$$;

revoke all on function public.merge_timetable(jsonb, uuid) from public, anon;
grant execute on function public.merge_timetable(jsonb, uuid) to authenticated;

commit;
