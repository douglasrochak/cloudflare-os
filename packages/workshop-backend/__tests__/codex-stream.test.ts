import { zstdDecompressSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { getModel, type CodexModelConfig } from '../src/ai-models';

const jwt = (account: string) => `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } }))}.signature`;
afterEach(() => vi.unstubAllGlobals());
it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('passes %s reasoning with SSE and fresh per-user auth', async reasoningEffort => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'test response' } }, { status: 400 }));
  vi.stubGlobal('fetch', request);
  const freshToken = vi.fn().mockResolvedValue(jwt('fresh-account'));
  const handle = getModel({ CF_AI_GATEWAY: 'platform', CF_AI_GATEWAY_ACCOUNT_ID: 'account',
    CF_AI_GATEWAY_PROVIDERS: 'cloudflare' } as Cloudflare.Env, {
    provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort,
    apiToken: jwt('initial-account'),
    codexAuth: { getAccessToken: freshToken } as CodexModelConfig['codexAuth'],
  }, { id: 'user', name: 'User', type: 'user' }, { userGateway: { accountId: 'other', apiKey: 'gateway-key' } });
  expect(handle.model.api).toBe('openai-codex-responses');
  expect(handle.aiGatewayLogRoute).toBeUndefined();
  const result = await handle.stream(handle.model, {
    messages: [{ role: 'user', content: 'test', timestamp: 0 }],
  }, { maxRetries: 0 }).result();
  expect(result.stopReason).toBe('error');
  expect(freshToken).toHaveBeenCalledTimes(1);
  expect(request, result.errorMessage).toHaveBeenCalledTimes(1);
  const sent = request.mock.calls[0][0] as Request;
  expect(sent.url).toBe('https://chatgpt.com/backend-api/codex/responses');
  expect(sent.headers.get('Authorization')).toBe(`Bearer ${jwt('fresh-account')}`);
  expect(sent.headers.get('chatgpt-account-id')).toBe('fresh-account');
  expect(sent.headers.has('cf-aig-authorization')).toBe(false);
  expect(sent.redirect).toBe('manual');
  const bytes = new Uint8Array(await sent.arrayBuffer());
  const decoded = sent.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes) : bytes;
  expect(JSON.parse(new TextDecoder().decode(decoded)).reasoning.effort).toBe(reasoningEffort);
});
