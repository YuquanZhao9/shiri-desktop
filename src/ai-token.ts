import type { SupabaseClient } from '@supabase/supabase-js';

// AI 同步令牌：让 AI 对话 / 自动任务通过云函数 ai-sync 改这个账号的日程。
// 云端存 SHA-256 哈希供云函数查找（cloud/schema-v4.sql），明文也存一份供本人以后再查看（cloud/schema-v12.sql，RLS 只给本人）。
// 云端还没运行 v12 时退回只存哈希，这时令牌只能在生成时看到。

export interface AiTokenInfo { hash: string; label: string; createdAt: string; lastUsedAt: string | null; token: string | null }

export const aiSyncUrl = (projectUrl: string) => `${new URL(projectUrl).origin}/functions/v1/ai-sync`;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'yst_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const missingPlainColumn = (message: string) => /token_plain/i.test(message);

function tableError(message: string): Error {
  return new Error(/shiri_ai_tokens|schema cache/i.test(message) ? '云端还没有令牌表，请先运行 cloud/schema-v4.sql。' : message);
}

/** 生成新令牌并返回明文。 */
export async function createAiToken(client: SupabaseClient, userId: string, label: string): Promise<string> {
  const token = randomToken();
  const row = { token_hash: await sha256(token), user_id: userId, label: label.trim().slice(0, 60) || 'AI 同步' };
  let { error } = await client.from('shiri_ai_tokens').insert({ ...row, token_plain: token });
  if (error && missingPlainColumn(error.message)) ({ error } = await client.from('shiri_ai_tokens').insert(row));
  if (error) throw tableError(error.message);
  return token;
}

export async function listAiTokens(client: SupabaseClient): Promise<AiTokenInfo[]> {
  const query = (columns: string) => client.from('shiri_ai_tokens').select(columns).order('created_at', { ascending: false });
  let { data, error } = await query('token_hash,label,created_at,last_used_at,token_plain');
  if (error && missingPlainColumn(error.message)) ({ data, error } = await query('token_hash,label,created_at,last_used_at'));
  if (error) throw tableError(error.message);
  return ((data ?? []) as unknown as { token_hash: string; label: string; created_at: string; last_used_at: string | null; token_plain?: string | null }[])
    .map(row => ({ hash: row.token_hash, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at, token: row.token_plain ?? null }));
}

export async function revokeAiToken(client: SupabaseClient, hash: string): Promise<void> {
  const { error } = await client.from('shiri_ai_tokens').delete().eq('token_hash', hash);
  if (error) throw tableError(error.message);
}
