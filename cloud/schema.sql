-- 拾日：在你自己的 Supabase SQL Editor 中运行一次。
-- 此脚本不会由应用自动执行；账号与数据库费用由你的项目配置决定。
-- 同步保留删除标记，不要手动清除 tombstone，否则长期离线设备可能恢复旧任务。
-- 冲突按客户端更新时间决胜；设备时钟严重不准时仍可能选错版本。

begin;

create table if not exists public.shiri_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  modified_at timestamptz not null,
  deleted boolean not null default false,
  primary key (user_id, id),
  constraint shiri_task_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_task_id_matches check (payload->>'id' = id and length(id) between 1 and 200),
  constraint shiri_task_has_title check (jsonb_typeof(payload->'title') = 'string'),
  constraint shiri_task_has_timestamp check (jsonb_typeof(payload->'updatedAt') = 'string')
);

alter table public.shiri_tasks enable row level security;
revoke all on table public.shiri_tasks from anon, authenticated;
grant select, insert, update, delete on table public.shiri_tasks to authenticated;

-- Mirrors src/core.ts taskConflictKey exactly: fixed fields separated by U+001F,
-- encoded as UTF-8 hex, compared with the C collation. Array order cannot make
-- identical recurring-task completion dates conflict.
create or replace function public.shiri_task_conflict_key(task_payload jsonb)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.convert_to(pg_catalog.array_to_string(array[
    task_payload->>'id', task_payload->>'title', task_payload->>'date',
    task_payload->>'time', task_payload->>'duration', task_payload->>'listId',
    task_payload->>'notes', task_payload->>'priority', task_payload->>'repeat',
    task_payload->>'completed',
    coalesce((select pg_catalog.string_agg(value, ',' order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(task_payload->'doneDates')), ''),
    task_payload->>'createdAt', task_payload->>'updatedAt',
    coalesce(task_payload->>'deletedAt', '')
  ], pg_catalog.chr(31)), 'UTF8'), 'hex');
$$;
revoke all on function public.shiri_task_conflict_key(jsonb) from public, anon;
grant execute on function public.shiri_task_conflict_key(jsonb) to authenticated;

drop policy if exists shiri_select_own on public.shiri_tasks;
create policy shiri_select_own on public.shiri_tasks for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_insert_own on public.shiri_tasks;
create policy shiri_insert_own on public.shiri_tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_update_own on public.shiri_tasks;
create policy shiri_update_own on public.shiri_tasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_delete_own on public.shiri_tasks;
create policy shiri_delete_own on public.shiri_tasks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- SECURITY INVOKER keeps the authenticated caller's RLS rules in force.
-- expected_user prevents a request from uploading a previous account's snapshot
-- if the frontend's active login changes while a sync is in progress.
create or replace function public.merge_tasks(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  task_payload jsonb;
  task_id text;
  changed_at timestamptz;
  removed_at timestamptz;
  is_deleted boolean;
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'array' then
    raise exception 'incoming must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(incoming) > 1000 then
    raise exception 'Sync batch is too large' using errcode = '22023';
  end if;

  for task_payload in select value from pg_catalog.jsonb_array_elements(incoming)
  loop
    if pg_catalog.jsonb_typeof(task_payload) <> 'object'
       or pg_catalog.jsonb_typeof(task_payload->'id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(task_payload->'title') is distinct from 'string'
       or pg_catalog.jsonb_typeof(task_payload->'updatedAt') is distinct from 'string' then
      raise exception 'Invalid task payload' using errcode = '22023';
    end if;
    task_id := task_payload->>'id';
    if pg_catalog.length(task_id) not between 1 and 200
       or pg_catalog.length(task_payload->>'title') > 1000
       or pg_catalog.octet_length(task_payload::text) > 1000000 then
      raise exception 'Task exceeds supported size' using errcode = '22023';
    end if;
    if task_payload->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Invalid task updatedAt timestamp' using errcode = '22023';
    end if;
    changed_at := (task_payload->>'updatedAt')::timestamptz;
    removed_at := null;
    is_deleted := task_payload->>'deletedAt' is not null;
    if is_deleted then
      if pg_catalog.jsonb_typeof(task_payload->'deletedAt') <> 'string'
         or task_payload->>'deletedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Invalid task deletedAt timestamp' using errcode = '22023';
      end if;
      removed_at := (task_payload->>'deletedAt')::timestamptz;
    end if;

    insert into public.shiri_tasks as stored (user_id, id, payload, modified_at, deleted)
      values (current_user_id, task_id, task_payload, greatest(changed_at, removed_at), is_deleted)
    on conflict (user_id, id) do update
      set payload = excluded.payload,
          modified_at = excluded.modified_at,
          deleted = excluded.deleted
      where excluded.modified_at > stored.modified_at
         or (excluded.modified_at = stored.modified_at and excluded.deleted and not stored.deleted)
         or (excluded.modified_at = stored.modified_at and excluded.deleted = stored.deleted
           and public.shiri_task_conflict_key(excluded.payload) collate "C"
             > public.shiri_task_conflict_key(stored.payload) collate "C");
    -- The final client pull returns canonical rows. A tombstone wins an equal
    -- timestamp, then the deterministic key makes all devices converge.
  end loop;
end;
$$;

revoke all on function public.merge_tasks(jsonb, uuid) from public, anon;
grant execute on function public.merge_tasks(jsonb, uuid) to authenticated;

commit;
