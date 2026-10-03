import type { SupabaseClient } from '@supabase/supabase-js';

// AI 同步令牌：让 AI 对话 / 自动任务通过云函数 ai-sync 改这个账号的日程。
// 令牌只在生成时显示一次；云端只存 SHA-256 哈希（cloud/schema-v4.sql）。

export interface AiTokenInfo { hash: string; label: string; createdAt: string; lastUsedAt: string | null }

export const aiSyncUrl = (projectUrl: string) => `${new URL(projectUrl).origin}/functions/v1/ai-sync`;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'yst_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tableError(message: string): Error {
  return new Error(/shiri_ai_tokens|schema cache/i.test(message) ? '云端还没有令牌表，请先运行 cloud/schema-v4.sql。' : message);
}

/** 生成新令牌并返回明文（只此一次）。 */
export async function createAiToken(client: SupabaseClient, userId: string, label: string): Promise<string> {
  const token = randomToken();
  const { error } = await client.from('shiri_ai_tokens').insert({ token_hash: await sha256(token), user_id: userId, label: label.trim().slice(0, 60) || 'AI 同步' });
  if (error) throw tableError(error.message);
  return token;
}

export async function listAiTokens(client: SupabaseClient): Promise<AiTokenInfo[]> {
  const { data, error } = await client.from('shiri_ai_tokens').select('token_hash,label,created_at,last_used_at').order('created_at', { ascending: false });
  if (error) throw tableError(error.message);
  return (data ?? []).map((row: { token_hash: string; label: string; created_at: string; last_used_at: string | null }) => ({ hash: row.token_hash, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
}

export async function revokeAiToken(client: SupabaseClient, hash: string): Promise<void> {
  const { error } = await client.from('shiri_ai_tokens').delete().eq('token_hash', hash);
  if (error) throw tableError(error.message);
}
