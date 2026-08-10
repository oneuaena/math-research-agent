# Provider Configuration

Math Research Agent supports a deterministic local coordinator and OpenAI-compatible Chat Completions providers. It is not an official client of any provider.

## Settings

Configure providers in the application UI; no `.env` file is used.

- **Base URL**: HTTPS service root, without a trailing slash. Loopback HTTP is allowed for development.
- **API key**: supplied by the user and encrypted with Electron safeStorage when Windows secure storage is available.
- **Model**: an exact chat-completion model identifier available to the account.
- **Provider HTTP timeout**: 120–600 seconds, independent from the local mathematical-tool timeout.

Example Base URL:

```text
https://api.deepseek.com
```

Choose a model and credentials your account is authorized to use. DeepSeek, OpenAI, Anthropic, and other names are compatibility examples only.

## Endpoint and connection test

The adapter resolves `POST /chat/completions` from the Base URL. The connection test sends a minimal non-streaming request equivalent to:

```json
{
  "model": "<configured-model>",
  "messages": [{ "role": "user", "content": "Reply only with OK" }],
  "stream": false,
  "max_tokens": 8
}
```

For compatible DeepSeek endpoints the request disables thinking. Success requires an actual model response, not a port-only connectivity check.

## Capability differences

Providers can differ in:

- native tool-call schemas and incremental arguments;
- `content`, `reasoning`, or `reasoning_content` behavior;
- JSON response modes and token limits;
- SSE framing and terminal events;
- quota, rate-limit, overload, and error payloads.

The adapter normalizes common Chat Completions and Responses-like content forms. SSE is assembled across `data:` frames until `[DONE]` or another terminal condition. A partial chunk is never parsed as a complete provider JSON document.

Structured model output is extracted separately from HTTP JSON. Invalid/truncated model JSON receives at most two compact repair calls. Transient DNS/TLS/timeout, truncated transport, HTTP 429, and selected 5xx failures receive bounded exponential-backoff retries. Completed research stages remain persisted at the checkpoint layer.

## Diagnostics and logs

UI diagnostics expose safe HTTP status, error type, endpoint, model, and elapsed time. Error types distinguish authentication, balance, bad request, rate limit, server/overload, DNS, TLS, timeout, abort, empty/truncated/SSE/HTML response, and malformed model output.

Rotating logs are stored locally under the application user-data `logs` directory. Authorization fields and key-shaped strings are redacted, but response content can contain sensitive research text. Do not attach raw logs to a public issue without review.

## Adding a provider

Follow the transport, credential, recovery, and test requirements in [CONTRIBUTING.md](../CONTRIBUTING.md). Public CI must use a local mock provider and must not require a paid API key.
