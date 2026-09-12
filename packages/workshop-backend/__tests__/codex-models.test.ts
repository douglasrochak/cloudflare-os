import { expect, it } from 'vitest';
import { CODEX_MODELS, codexReasoningLevels, validateCodexReasoning, checkCodexResponse } from '../src/codex-models';

it('includes Astra and retains the bundled models', () => {
  expect(CODEX_MODELS['gpt-6-astra'].api).toBe('openai-codex-responses');
  expect(CODEX_MODELS['gpt-5.6-luna']).toBeDefined();
  expect(CODEX_MODELS['gpt-5.3-codex-spark']).toBeDefined();
});
it('validates reasoning by model and preserves the old medium default', () => {
  expect(validateCodexReasoning('gpt-5.6-luna')).toBe('medium');
  expect(validateCodexReasoning('gpt-6-astra', 'max')).toBe('max');
  expect(codexReasoningLevels('gpt-5.3-codex-spark')).not.toContain('max');
  expect(() => validateCodexReasoning('gpt-5.3-codex-spark', 'max')).toThrow('not supported');
  expect(() => validateCodexReasoning('toString')).toThrow('Unknown');
});
it('replaces an HTML block page with a safe actionable error', async () => {
  const response = new Response('<html>private provider diagnostic</html>', {
    status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  await expect(checkCodexResponse(response)).rejects.toThrow('OpenAI blocked');
  expect(response.bodyUsed).toBe(true);
});
it('preserves structured errors and successful streams', async () => {
  const response = Response.json({ error: { message: 'quota exceeded' } }, { status: 429 });
  expect(await checkCodexResponse(response)).toBe(response);
  const stream = new Response('data: test\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  expect(await checkCodexResponse(stream)).toBe(stream);
});
