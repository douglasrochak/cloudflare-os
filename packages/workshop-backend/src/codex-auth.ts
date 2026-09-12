import type { CodexLogin, CodexConnectionStatus } from '@gadgets/workshop-shared/api';

// Same device authorization client and endpoints as pi-ai's openai-codex provider.
const AUTH = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_KEY = 'codex:tokens';
const LOGIN_KEY = 'codex:login';
const COOLDOWN_KEY = 'codex:next-login';

type Tokens = { access: string; refresh: string; expires: number };
type PendingLogin = CodexLogin & { deviceAuthId: string; nextPollAt: number };

/** The user's private durable storage; credentials never enter the public RPC response. */
export interface CodexStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** Extracts routing metadata, not authorization, from an OpenAI-issued access token. */
export function codexAccountId(token: string): string {
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    if (typeof accountId === 'string' && accountId.length > 0) return accountId;
  } catch { /* Never include token contents in errors. */ }
  throw new Error('Codex returned an invalid session. Connect your account again.');
}

/** Device login and refresh lifecycle, serialized to avoid rotating a refresh token twice. */
export class CodexConnection {
  #tail: Promise<unknown> = Promise.resolve();
  constructor(private storage: CodexStorage, private request: typeof fetch = fetch,
              private now: () => number = Date.now) {}

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #post(path: string, body: object | URLSearchParams): Promise<Response> {
    try {
      return await this.request(`${AUTH}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': body instanceof URLSearchParams
            ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: body instanceof URLSearchParams ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: 'manual',
      });
    } catch {
      throw new Error('Could not reach Codex. Please try again.');
    }
  }

  async #tokens(response: Response): Promise<Tokens> {
    if (!response.ok) throw new Error('Codex authorization failed. Connect your account again.');
    const data = await response.json().catch(() => { throw new Error('Codex returned an invalid response. Please try again.'); }) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' ||
        typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error('Codex returned an invalid session. Connect your account again.');
    }
    codexAccountId(data.access_token);
    return { access: data.access_token, refresh: data.refresh_token,
      expires: this.now() + data.expires_in * 1000 };
  }

  /** Reports connection state without exposing credentials. */
  async status(): Promise<CodexConnectionStatus> {
    return { connected: !!await this.storage.get<Tokens>(TOKEN_KEY) };
  }

  /** Starts or reuses a bounded device login; only its user-facing code leaves the server. */
  start(): Promise<CodexLogin> {
    return this.#exclusive(async () => {
      const pending = await this.storage.get<PendingLogin>(LOGIN_KEY);
      if (pending && pending.expiresAt > this.now()) return this.#publicLogin(pending);
      const nextLogin = await this.storage.get<number>(COOLDOWN_KEY) ?? 0;
      if (nextLogin > this.now()) throw new Error('Please wait a few seconds before trying again.');
      await this.storage.put(COOLDOWN_KEY, this.now() + 30_000);
      const response = await this.#post('/api/accounts/deviceauth/usercode', { client_id: CLIENT_ID });
      if (!response.ok) throw new Error('Codex device login is unavailable. Enable device code authorization in your ChatGPT security settings, then retry.');
      const data = await response.json().catch(() => { throw new Error('Codex returned an invalid response. Please try again.'); }) as Record<string, unknown>;
      const interval = Number(data.interval);
      if (typeof data.device_auth_id !== 'string' || typeof data.user_code !== 'string' ||
          !Number.isFinite(interval) || interval < 0) throw new Error('Codex returned an invalid login code. Try again.');
      const login: PendingLogin = {
        loginId: crypto.randomUUID(), userCode: data.user_code,
        verificationUri: 'https://auth.openai.com/codex/device',
        intervalMs: Math.max(5000, interval * 1000), expiresAt: this.now() + 15 * 60_000,
        deviceAuthId: data.device_auth_id, nextPollAt: this.now() + Math.max(5000, interval * 1000),
      };
      await this.storage.put(LOGIN_KEY, login);
      return this.#publicLogin(login);
    });
  }

  #publicLogin({ loginId, userCode, verificationUri, intervalMs, expiresAt }: PendingLogin): CodexLogin {
    return { loginId, userCode, verificationUri, intervalMs, expiresAt };
  }

  /** Polls once, respecting the issuer's interval and rejecting stale or cross-tab login IDs. */
  poll(loginId: string): Promise<CodexConnectionStatus> {
    return this.#exclusive(async () => {
      const pending = await this.storage.get<PendingLogin>(LOGIN_KEY);
      if (!pending || pending.loginId !== loginId) throw new Error('This login is no longer active. Start again.');
      if (pending.expiresAt <= this.now()) {
        await this.storage.delete(LOGIN_KEY);
        throw new Error('Your login code expired. Start again.');
      }
      if (pending.nextPollAt > this.now()) return { connected: false };
      pending.nextPollAt = this.now() + pending.intervalMs;
      await this.storage.put(LOGIN_KEY, pending);
      const response = await this.#post('/api/accounts/deviceauth/token', {
        device_auth_id: pending.deviceAuthId, user_code: pending.userCode,
      });
      if (response.status === 403 || response.status === 404) return { connected: false };
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string | { code?: string } };
        const code = typeof data.error === 'string' ? data.error : data.error?.code;
        if (code === 'deviceauth_authorization_pending') return { connected: false };
        if (code === 'slow_down' || response.status === 429) {
          pending.intervalMs = Math.min(pending.intervalMs + 5000, 60_000);
          pending.nextPollAt = this.now() + pending.intervalMs;
          await this.storage.put(LOGIN_KEY, pending);
          return { connected: false };
        }
        throw new Error('Codex sign-in failed. Start again.');
      }
      const data = await response.json().catch(() => { throw new Error('Codex returned an invalid response. Please try again.'); }) as Record<string, unknown>;
      if (typeof data.authorization_code !== 'string' || typeof data.code_verifier !== 'string') {
        throw new Error('Codex returned an invalid authorization. Start again.');
      }
      const tokens = await this.#tokens(await this.#post('/oauth/token', new URLSearchParams({
        grant_type: 'authorization_code', client_id: CLIENT_ID, code: data.authorization_code,
        code_verifier: data.code_verifier, redirect_uri: `${AUTH}/deviceauth/callback`,
      })));
      await this.storage.put(TOKEN_KEY, tokens);
      await this.storage.delete(LOGIN_KEY);
      return { connected: true };
    });
  }

  /** Only cancels the named attempt so a stale tab cannot cancel a newer login. */
  cancel(loginId: string): Promise<void> {
    return this.#exclusive(async () => {
      if ((await this.storage.get<PendingLogin>(LOGIN_KEY))?.loginId === loginId) {
        await this.storage.delete(LOGIN_KEY);
      }
    });
  }

  /** Removes the local grant; already-running requests may finish. */
  disconnect(): Promise<void> {
    return this.#exclusive(async () => {
      await this.storage.delete(TOKEN_KEY);
      await this.storage.delete(LOGIN_KEY);
    });
  }

  /** Backend-only: refreshes and durably stores rotating credentials before returning an access token. */
  accessToken(): Promise<string> {
    return this.#exclusive(async () => {
      let tokens = await this.storage.get<Tokens>(TOKEN_KEY);
      if (!tokens) throw new Error('Connect your ChatGPT / Codex account in Add AI Model.');
      if (tokens.expires <= this.now() + 60_000) {
        const response = await this.#post('/oauth/token', new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: tokens.refresh, client_id: CLIENT_ID,
        }));
        if (response.status === 400 || response.status === 401) await this.storage.delete(TOKEN_KEY);
        tokens = await this.#tokens(response);
        await this.storage.put(TOKEN_KEY, tokens);
      }
      return tokens.access;
    });
  }
}
