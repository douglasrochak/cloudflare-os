import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
import type { Model } from '@earendil-works/pi-ai';
import type { CodexReasoningEffort } from '@gadgets/workshop-shared/api';

/**
 * Supplement the pinned adapter catalog with the public Codex model.
 * https://developers.openai.com/api/docs/models/gpt-6-astra
 * Keep a conservative context budget until an account-specific catalog is available.
 */
export const CODEX_MODELS: Record<string, Model<'openai-codex-responses'>> = {
  ...OPENAI_CODEX_MODELS,
  'gpt-6-astra': {
    id: 'gpt-6-astra', name: 'GPT-6 Astra', api: 'openai-codex-responses',
    provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api',
    reasoning: true, input: ['text', 'image'], contextWindow: 272000, maxTokens: 128000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevelMap: { xhigh: 'xhigh', max: 'max', minimal: 'low' },
  },
};

/** Reasoning efforts understood by the direct adapter for this model. */
export function codexReasoningLevels(modelId: string): CodexReasoningEffort[] {
  const model = Object.hasOwn(CODEX_MODELS, modelId) ? CODEX_MODELS[modelId] : undefined;
  if (!model) throw new Error('Unknown Codex model. Choose one from the list.');
  return ['low', 'medium', 'high', 'xhigh', ...(model.thinkingLevelMap?.max ? ['max' as const] : [])];
}

/** Reject unsupported settings before they are stored or sent to the provider. */
export function validateCodexReasoning(modelId: string, effort: CodexReasoningEffort = 'medium'): CodexReasoningEffort {
  if (!codexReasoningLevels(modelId).includes(effort)) {
    throw new Error('This reasoning level is not supported by the selected Codex model.');
  }
  return effort;
}

/** Do not pass a provider's HTML block page (or its request details) into chat history. */
export async function checkCodexResponse(response: Response): Promise<Response> {
  if (!response.ok && /text\/html/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw new Error('OpenAI blocked the request from this server before it reached Codex. Your account may still be connected. Contact the instance administrator to check the Codex connection.');
  }
  return response;
}
