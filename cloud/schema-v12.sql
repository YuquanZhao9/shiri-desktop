-- 昱时 云同步第 12 版：AI 同步令牌可以随时再查看。在 schema-v4.sql 之后运行一次（可重复运行）。
-- 用户要求令牌不只显示一次，所以新令牌的明文也存进 token_plain。
-- 仍受 RLS 保护：只有登录的本人能读到自己的令牌；云函数 ai-sync 照旧按 SHA-256 哈希查找。
-- 这一版之前生成的令牌没有存明文，查看不了，需要的话重新生成一个。

begin;

alter table public.shiri_ai_tokens add column if not exists token_plain text
  check (token_plain is null or token_plain ~ '^yst_[A-Za-z0-9_-]{20,64}$');

commit;
