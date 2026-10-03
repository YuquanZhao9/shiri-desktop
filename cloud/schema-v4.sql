-- 昱时 云同步第 4 版：AI 同步令牌。在 schema-v3.sql 之后运行一次（可重复运行）。
-- 用户在电脑版设置或手机"我的"里生成令牌，云端只保存 SHA-256 哈希。
-- 云函数 ai-sync 用令牌哈希找到账号，再读写该账号的日程；令牌不能登录、不能读其他数据。

begin;

create table if not exists public.shiri_ai_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'AI 同步' check (length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists shiri_ai_tokens_user on public.shiri_ai_tokens (user_id);

alter table public.shiri_ai_tokens enable row level security;
revoke all on table public.shiri_ai_tokens from anon, authenticated;
-- 客户端只能新增、查看、撤销自己的令牌；last_used_at 只由云函数写。
grant select, insert, delete on table public.shiri_ai_tokens to authenticated;

drop policy if exists shiri_ai_tokens_select_own on public.shiri_ai_tokens;
create policy shiri_ai_tokens_select_own on public.shiri_ai_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists shiri_ai_tokens_insert_own on public.shiri_ai_tokens;
create policy shiri_ai_tokens_insert_own on public.shiri_ai_tokens for insert to authenticated
  with check ((select auth.uid()) = user_id and last_used_at is null);
drop policy if exists shiri_ai_tokens_delete_own on public.shiri_ai_tokens;
create policy shiri_ai_tokens_delete_own on public.shiri_ai_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 外部来源（如邮件）与日程的对应，防止同一封邮件重复加入。只有云函数（service role）读写。
create table if not exists public.shiri_ai_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 300),
  task_id text not null,
  source text not null default 'ai',
  created_at timestamptz not null default now(),
  primary key (user_id, external_id)
);
alter table public.shiri_ai_links enable row level security;
revoke all on table public.shiri_ai_links from anon, authenticated;

commit;
