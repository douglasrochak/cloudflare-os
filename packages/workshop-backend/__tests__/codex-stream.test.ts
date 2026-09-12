import { afterEach, expect, it, vi } from 'vitest';
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
import { getModel, type CodexModelConfig } from '../src/ai-models';

const jwt = (account: string) => `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } }))}.signature`;
afterEach(() => vi.unstubAllGlobals());
it('uses SSE in workerd and fresh per-user auth instead of either AI Gateway', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'test response' } }, { status: 400 }));
  vi.stubGlobal('fetch', request);
  const freshToken = vi.fn().mockResolvedValue(jwt('fresh-account'));
  const handle = getModel({ CF_AI_GATEWAY: 'platform', CF_AI_GATEWAY_ACCOUNT_ID: 'account',
    CF_AI_GATEWAY_PROVIDERS: 'cloudflare' } as Cloudflare.Env, {
    provider: 'openai-codex', model: Object.values(OPENAI_CODEX_MODELS)[0].id,
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
});
