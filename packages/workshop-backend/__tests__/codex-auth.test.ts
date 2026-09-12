import { describe, expect, it, vi } from 'vitest';
import { CodexConnection, type CodexStorage } from '../src/codex-auth';

const access = `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } }))}.signature`;
function setup() {
  const records = new Map<string, unknown>();
  const storage: CodexStorage = {
    async get<T>(key: string) { return structuredClone(records.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { records.set(key, structuredClone(value)); },
    async delete(key: string) { return records.delete(key); },
  };
  let now = 100_000;
  const request = vi.fn<typeof fetch>();
  const connection = new CodexConnection(storage, request, () => now);
  return { records, storage, request, connection, advance(ms: number) { now += ms; } };
}
function device() {
  return Response.json({ device_auth_id: 'private-device-id', user_code: 'ABCD-EFGH', interval: '5' });
}
function tokens() { return Response.json({ access_token: access, refresh_token: 'private-refresh', expires_in: 3600 }); }

describe('Codex device authorization', () => {
  it('does not call fetch with the connection as its receiver', async () => {
    const { storage } = setup();
    const request = async function(this: unknown) {
      // Native Worker fetch rejects an arbitrary class instance as `this`.
      expect(this).toBeUndefined();
      return device();
    };
    const connection = new CodexConnection(storage, request);
    expect((await connection.start()).userCode).toBe('ABCD-EFGH');
  });

  it('reuses a pending login and never exposes its private ID', async () => {
    const { connection, request } = setup();
    request.mockResolvedValueOnce(device());
    const first = await connection.start();
    expect(await connection.start()).toEqual(first);
    expect(first).not.toHaveProperty('deviceAuthId');
    expect(first.verificationUri).toBe('https://auth.openai.com/codex/device');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('throttles polling, exchanges a grant and persists tokens privately', async () => {
    const { connection, request, records, advance } = setup();
    request.mockResolvedValueOnce(device())
      .mockResolvedValueOnce(Response.json({ authorization_code: 'code', code_verifier: 'verifier' }))
      .mockResolvedValueOnce(tokens());
    const login = await connection.start();
    expect(await connection.poll(login.loginId)).toEqual({ connected: false });
    expect(request).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(await connection.poll(login.loginId)).toEqual({ connected: true });
    expect(await connection.status()).toEqual({ connected: true });
    expect(records.has('codex:login')).toBe(false);
    expect(await connection.accessToken()).toBe(access);
    const init = request.mock.calls[2][1]!;
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(init.redirect).toBe('manual');
  });

  it('rejects unknown and expired attempts before contacting OpenAI', async () => {
    const { connection, request, advance } = setup();
    request.mockResolvedValueOnce(device());
    const login = await connection.start();
    await expect(connection.poll('another-user')).rejects.toThrow('no longer active');
    advance(15 * 60_000);
    await expect(connection.poll(login.loginId)).rejects.toThrow('expired');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a stale cancel cannot remove a newer attempt', async () => {
    const { connection, request } = setup();
    request.mockResolvedValueOnce(device());
    const login = await connection.start();
    await connection.cancel('stale-id');
    expect(await connection.start()).toEqual(login);
    await connection.cancel(login.loginId);
    await expect(connection.poll(login.loginId)).rejects.toThrow('no longer active');
  });

  it('honors slow_down and does not busy-poll the provider', async () => {
    const { connection, request, advance } = setup();
    request.mockResolvedValueOnce(device()).mockResolvedValueOnce(Response.json({ error: 'slow_down' }, { status: 429 }));
    const login = await connection.start();
    advance(5000);
    await connection.poll(login.loginId);
    advance(5000);
    expect(await connection.poll(login.loginId)).toEqual({ connected: false });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('serializes refreshes and saves the rotated refresh token', async () => {
    const { connection, request, storage, records } = setup();
    await storage.put('codex:tokens', { access, refresh: 'old-refresh', expires: 0 });
    request.mockResolvedValueOnce(tokens());
    expect(await Promise.all([connection.accessToken(), connection.accessToken()])).toEqual([access, access]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(records.get('codex:tokens')).toMatchObject({ refresh: 'private-refresh' });
  });

  it('revoked grants require reconnect and never leak a provider error body', async () => {
    const { connection, request, storage } = setup();
    await storage.put('codex:tokens', { access, refresh: 'old-refresh', expires: 0 });
    request.mockResolvedValueOnce(Response.json({ secret: 'private-provider-body' }, { status: 401 }));
    await expect(connection.accessToken()).rejects.toThrow('Connect your account again');
    expect(await connection.status()).toEqual({ connected: false });
  });

  it('disconnect prevents future token access', async () => {
    const { connection, storage } = setup();
    await storage.put('codex:tokens', { access, refresh: 'refresh', expires: 9e12 });
    await connection.disconnect();
    await expect(connection.accessToken()).rejects.toThrow('Connect your ChatGPT');
  });
});
