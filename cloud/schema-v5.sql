-- 昱时 云同步第 5 版：日记。在 schema-v4.sql 之后运行一次（可重复运行）。
-- 每个账号每天一行，payload 与 src/types.ts 的 JournalEntry 相同（date/text/updatedAt）；
-- 较新的 updatedAt 为准，时间相同按文本决出（同 src/journal.ts newerEntry）。删除 = 空文本，好让删除也同步。

begin;

create table if not exists public.shiri_journal (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  payload jsonb not null,
  updated_at timestamptz not null,
  primary key (user_id, day),
  constraint shiri_journal_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_journal_size check (octet_length(payload::text) < 250000)
);

alter table public.shiri_journal enable row level security;
alter table public.shiri_journal replica identity full;
revoke all on table public.shiri_journal from anon, authenticated;
grant select, insert, update, delete on table public.shiri_journal to authenticated;

drop policy if exists shiri_journal_select_own on public.shiri_journal;
create policy shiri_journal_select_own on public.shiri_journal for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_journal_insert_own on public.shiri_journal;
create policy shiri_journal_insert_own on public.shiri_journal for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_journal_update_own on public.shiri_journal;
create policy shiri_journal_update_own on public.shiri_journal for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_journal_delete_own on public.shiri_journal;
create policy shiri_journal_delete_own on public.shiri_journal for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_journal'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_journal';
  end if;
end;
$$;

-- incoming 是日记数组；只有比云端新的才写入。
create or replace function public.merge_journal(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  entry jsonb;
  changed_at timestamptz;
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'array' or pg_catalog.jsonb_array_length(incoming) > 500 then
    raise exception 'Invalid journal payload' using errcode = '22023';
  end if;
  for entry in select value from pg_catalog.jsonb_array_elements(incoming) loop
    if pg_catalog.jsonb_typeof(entry) <> 'object'
       or entry->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
       or pg_catalog.jsonb_typeof(entry->'text') is distinct from 'string'
       or entry->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
       or (select count(*) from pg_catalog.jsonb_object_keys(entry)) <> 3 then
      raise exception 'Invalid journal entry' using errcode = '22023';
    end if;
    changed_at := (entry->>'updatedAt')::timestamptz;
    insert into public.shiri_journal as stored (user_id, day, payload, updated_at)
      values (current_user_id, (entry->>'date')::date, entry, changed_at)
    on conflict (user_id, day) do update
      set payload = excluded.payload, updated_at = excluded.updated_at
      where excluded.updated_at > stored.updated_at
         or (excluded.updated_at = stored.updated_at and excluded.payload->>'text' collate "C" > stored.payload->>'text' collate "C");
  end loop;
end;
$$;

revoke all on function public.merge_journal(jsonb, uuid) from public, anon;
grant execute on function public.merge_journal(jsonb, uuid) to authenticated;

commit;

-- 每天 21:00 还没写日记就推送（shiri-reminders 云函数读取）；手机“我的 → 日程提醒”里可关。
alter table public.shiri_push_subscriptions add column if not exists journal_reminder boolean not null default true;
