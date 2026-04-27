// Thin wrapper around the DocHub AI proxy. We POST through DocHub
// rather than calling Anthropic directly so the API key + token-spend
// audit live in one place. Two env vars wire it up:
//
//   AI_PROXY_URL    default https://dochub.pcc2k.com/api/ai/proxy
//   AI_PROXY_TOKEN  the bearer that DocHub validates (matching env on
//                   DocHub side: AI_PROXY_TOKEN)
//
// All errors (proxy down, bad token, model-side failure, JSON parse)
// surface as { ok: false, error } so callers can keep the UI usable.

const DEFAULT_URL = 'https://dochub.pcc2k.com/api/ai/proxy';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 60_000;

export async function callProxy(messages, opts = {}) {
  const url = process.env.AI_PROXY_URL || DEFAULT_URL;
  const token = process.env.AI_PROXY_TOKEN;
  if (!token) {
    return { ok: false, error: 'AI_PROXY_TOKEN not configured on the server' };
  }

  const body = JSON.stringify({
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.max_tokens ?? 2048,
    ...(opts.system ? { system: opts.system } : {}),
    messages,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-App': 'coinhub',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `proxy ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    const json = await res.json();
    return { ok: true, response: json };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Helper that pulls a JSON block out of the model's response. The
 * model is asked to return JSON; sometimes it wraps in ```json ... ```
 * fences, sometimes it adds prose. We strip both.
 */
export function extractJson(response) {
  if (!response?.content) return null;
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  // Look for a fenced ```json ... ``` block first (most common when
  // we ask for structured output).
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last-ditch: find the first JSON-shaped substring.
    const m = candidate.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}
