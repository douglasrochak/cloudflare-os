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
