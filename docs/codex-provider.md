# ChatGPT / Codex provider

In **Add AI Model**, choose **Connect ChatGPT / Codex**, then **Sign in with ChatGPT / Codex**.
Open the OpenAI link, enter the displayed code and approve sign-in. Return to Cloudflare OS,
choose a model and select **Add Codex model**. Each Cloudflare OS user connects their own account.
If device authorization is disabled, enable it in your ChatGPT security settings before retrying.

This uses the `openai-codex` adapter in the pinned `@earendil-works/pi-ai` dependency, with a
Worker-compatible device login implementation. It is a subscription connection, not an OpenAI
Platform API key. The model catalog is bundled with pi-ai; actual model access and usage limits
are determined by your account. Compatibility with the provider's device endpoints must be
verified during a real login after deployment.

Codex requests use fetch/SSE directly to ChatGPT, independently of the deployment's AI Gateway.
Existing gateway models remain available. Text and image attachments are supported; PDF uploads
are not enabled for this provider. Background quick-model tasks retain the existing gateway
configuration.

Tokens are stored in the owning user's existing Durable Object. Refreshes are serialized and the
rotated token is persisted before use. Browser RPC responses contain only connection state,
login instructions and model names. A server-minted capability refreshes access during model
requests, including long-running turns and gadget bindings. No new Durable Object class,
namespace, Worker binding or migration is required for Codex.

**Disconnect Codex** removes the local grant and saved Codex model entries. It does not revoke the
upstream OpenAI authorization or interrupt a request already in flight. Existing model bindings
fail with a reconnect message once disconnected. A revoked or invalid refresh grant also requires
reconnecting.

Validation: backend `codex-auth`, `codex-stream` and `ai-models` tests exercise workerd with fake
provider responses. They do not prove a real account can sign in or use a model. After deployment,
verify device authorization, one chat/tool round trip, token renewal, a negative user-isolation
check and disconnect using the intended account.

Reference: [OpenAI authentication](https://learn.chatgpt.com/docs/auth).

## Model and reasoning choices

The picker uses the pinned pi-ai catalog plus the public GPT-6 Astra descriptor in
`codex-models.ts`. It is a supported-model list, **not an account-entitlement query**.
Astra uses a conservative 272k context budget; this does not claim the account's maximum window.
Each saved model/effort combination has its own profile ID so it can be selected in chat.
Existing profiles without an effort retain `medium`. The backend validates the effort for the
model; the stream passes it to `reasoning.effort`. `max` is shown only for models that support it.
Codex app features such as automatic task delegation are not implemented by this direct adapter.

## Server-side blocking

A successful device login does not prove inference is reachable. In the deployed Worker test,
OpenAI returned an HTML block page for the inference request. The adapter now turns HTML error
pages into a concise error without copying the page into chat history. This does not bypass or
resolve OpenAI's network policy. Do not rotate addresses or disguise requests to work around it.
Use the official Codex application/App Server in an approved environment, or resolve the block
with the provider. A future App Server integration can use its documented `model/list` method
for account-specific model and reasoning discovery; it is not part of this direct adapter.
