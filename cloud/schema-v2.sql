-- 昱时 云同步第 2 版：在 cloud/schema.sql 之后运行一次（可重复运行）。
-- 1. 让日程表发出实时变更，另一台设备几秒内收到。
-- 2. 新增清单表，清单名称和颜色也在电脑与手机之间同步。
-- 数据格式不变：shiri_tasks.payload 仍是 src/types.ts 的 Task。

begin;

-- ---------- 实时推送 ----------
-- Realtime 按 RLS 过滤，每个账号只收到自己的行。
alter table public.shiri_tasks replica identity full;
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_tasks'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_tasks';
  end if;
end;
$$;

-- ---------- 清单 ----------
-- payload 与 src/types.ts 的 TaskList 相同：{ id, name, color }。
-- 清单没有自带时间戳，modified_at 由服务器在内容变化时写入：最后一次改动为准。
create table if not exists public.shiri_lists (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  modified_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint shiri_list_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shiri_list_id_matches check (payload->>'id' = id and length(id) between 1 and 128),
  constraint shiri_list_has_name check (jsonb_typeof(payload->'name') = 'string'),
  constraint shiri_list_has_color check (payload->>'color' ~ '^#[0-9A-Fa-f]{6}$')
);

alter table public.shiri_lists enable row level security;
alter table public.shiri_lists replica identity full;
revoke all on table public.shiri_lists from anon, authenticated;
grant select, insert, update, delete on table public.shiri_lists to authenticated;

drop policy if exists shiri_lists_select_own on public.shiri_lists;
create policy shiri_lists_select_own on public.shiri_lists for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_lists_insert_own on public.shiri_lists;
create policy shiri_lists_insert_own on public.shiri_lists for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_lists_update_own on public.shiri_lists;
create policy shiri_lists_update_own on public.shiri_lists for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_lists_delete_own on public.shiri_lists;
create policy shiri_lists_delete_own on public.shiri_lists for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shiri_lists'
     ) then
    execute 'alter publication supabase_realtime add table public.shiri_lists';
  end if;
end;
$$;

-- 客户端只上传自己改过的清单（与上次拉取的版本不同）。
-- 内容相同则不动，避免两台设备来回覆盖。
create or replace function public.merge_lists(incoming jsonb, expected_user uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  list_payload jsonb;
  list_id text;
begin
  if current_user_id is null or current_user_id is distinct from expected_user then
    raise exception 'Account changed during sync' using errcode = '42501';
  end if;
  if incoming is null or pg_catalog.jsonb_typeof(incoming) <> 'array' then
    raise exception 'incoming must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(incoming) > 200 then
    raise exception 'Too many lists' using errcode = '22023';
  end if;

  for list_payload in select value from pg_catalog.jsonb_array_elements(incoming)
  loop
    if pg_catalog.jsonb_typeof(list_payload) <> 'object'
       or pg_catalog.jsonb_typeof(list_payload->'id') is distinct from 'string'
       or pg_catalog.jsonb_typeof(list_payload->'name') is distinct from 'string'
       or pg_catalog.jsonb_typeof(list_payload->'color') is distinct from 'string'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(list_payload)) <> 3 then
      raise exception 'Invalid list payload' using errcode = '22023';
    end if;
    list_id := list_payload->>'id';
    if list_id !~ '^[A-Za-z0-9_-]{1,128}$'
       or pg_catalog.length(list_payload->>'name') not between 1 and 80
       or list_payload->>'color' !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Invalid list payload' using errcode = '22023';
    end if;

    insert into public.shiri_lists as stored (user_id, id, payload, modified_at)
      values (current_user_id, list_id, list_payload, pg_catalog.now())
    on conflict (user_id, id) do update
      set payload = excluded.payload, modified_at = excluded.modified_at
      where stored.payload is distinct from excluded.payload;
  end loop;
end;
$$;

revoke all on function public.merge_lists(jsonb, uuid) from public, anon;
grant execute on function public.merge_lists(jsonb, uuid) to authenticated;

-- ---------- 手机推送提醒 ----------
-- 每台开启提醒的 iPhone 一行。时区和提前分钟数由手机上报，云端据此计算提醒时间。
create table if not exists public.shiri_push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and length(endpoint) < 2000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) < 200),
  auth text not null check (length(auth) < 100),
  time_zone text not null default 'Asia/Shanghai' check (length(time_zone) < 64),
  lead_minutes integer not null default 10 check (lead_minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shiri_push_subscriptions_user on public.shiri_push_subscriptions (user_id);

alter table public.shiri_push_subscriptions enable row level security;
revoke all on table public.shiri_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.shiri_push_subscriptions to authenticated;

drop policy if exists shiri_push_select_own on public.shiri_push_subscriptions;
create policy shiri_push_select_own on public.shiri_push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_push_insert_own on public.shiri_push_subscriptions;
create policy shiri_push_insert_own on public.shiri_push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_push_update_own on public.shiri_push_subscriptions;
create policy shiri_push_update_own on public.shiri_push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists shiri_push_delete_own on public.shiri_push_subscriptions;
create policy shiri_push_delete_own on public.shiri_push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 已发送记录，防止同一提醒重复推送。只有云函数（service role）读写。
create table if not exists public.shiri_push_sent (
  endpoint text not null,
  occurrence text not null,
  sent_at timestamptz not null default now(),
  primary key (endpoint, occurrence)
);
alter table public.shiri_push_sent enable row level security;
revoke all on table public.shiri_push_sent from anon, authenticated;

commit;
