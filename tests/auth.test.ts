import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PASSWORD_RESET_REDIRECT, requestPasswordReset, signUp, updatePassword } from '../src/cloud';

const fakeClient = (auth: Record<string, unknown>) => ({ auth }) as unknown as SupabaseClient;

test('duplicate signup error becomes an explicit reset offer', async () => {
  const client = fakeClient({
    signUp: async () => ({ data: { user: null, session: null }, error: { message: 'User already registered' } }),
  });
  const result = await signUp(client, ' existing@example.com ', 'password123');
  assert.equal(result.alreadyRegistered, true);
  assert.equal(result.user, null);
});

test('obfuscated signup with no identities is recognized as an existing email', async () => {
  const client = fakeClient({
    signUp: async () => ({ data: { user: { id: 'masked', identities: [] }, session: null }, error: null }),
  });
  const result = await signUp(client, 'existing@example.com', 'password123');
  assert.equal(result.alreadyRegistered, true);
});

test('new signup is not mistaken for an existing email', async () => {
  const client = fakeClient({
    signUp: async () => ({ data: { user: { id: 'new', identities: [{ id: 'email' }] }, session: null }, error: null }),
  });
  const result = await signUp(client, 'new@example.com', 'password123');
  assert.equal(result.alreadyRegistered, false);
  assert.equal(result.needsEmailConfirmation, true);
});

test('password reset trims the email and uses the published recovery page', async () => {
  let received: unknown[] = [];
  const client = fakeClient({
    resetPasswordForEmail: async (...args: unknown[]) => { received = args; return { data: {}, error: null }; },
  });
  await requestPasswordReset(client, ' user@example.com ');
  assert.deepEqual(received, ['user@example.com', { redirectTo: PASSWORD_RESET_REDIRECT }]);
});

test('password update rejects short values before contacting Supabase', async () => {
  let called = false;
  const client = fakeClient({
    updateUser: async () => { called = true; return { data: {}, error: null }; },
  });
  await assert.rejects(() => updatePassword(client, 'short'), /至少需要 8 位/);
  assert.equal(called, false);
});

test('password update keeps the same account and sends only the new password', async () => {
  let received: unknown;
  const client = fakeClient({
    updateUser: async (value: unknown) => { received = value; return { data: {}, error: null }; },
  });
  await updatePassword(client, 'new-password-123');
  assert.deepEqual(received, { password: 'new-password-123' });
});
