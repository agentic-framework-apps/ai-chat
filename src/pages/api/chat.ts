import type { APIRoute } from 'astro';
import {
  HISTORY_LIMIT,
  isValidSessionId,
  loadHistory,
  saveHistory,
  type ChatMessage,
} from '../../lib/chat';

export const prerender = false;

const MODEL = '@cf/meta/llama-3.2-3b-instruct';
const SYSTEM_PROMPT = 'You are ShortChat, a concise and helpful assistant. Answer directly.';
const MAX_INPUT = 4000;
const MINUTE_LIMIT = 30;
const DAY_LIMIT = 200;

async function isRateLimited(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `rl:${ip}`;
  const raw = await kv.get(key);
  const now = Date.now();
  let minute = 0;
  let day = 0;
  let windowStart = now;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { m?: number; d?: number; ts?: number };
      minute = typeof parsed.m === 'number' ? parsed.m : 0;
      day = typeof parsed.d === 'number' ? parsed.d : 0;
      windowStart = typeof parsed.ts === 'number' ? parsed.ts : now;
    } catch {
      // treat unreadable entry as a fresh window
    }
  }
  if (now - windowStart >= 60000) {
    minute = 0;
    windowStart = now;
  }
  if (minute >= MINUTE_LIMIT || day >= DAY_LIMIT) return true;
  await kv.put(
    key,
    JSON.stringify({ m: minute + 1, d: day + 1, ts: windowStart }),
    { expirationTtl: 86400 },
  );
  return false;
}

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (await isRateLimited(env.CHAT_KV, ip)) {
    return json({ error: 'Too many requests. Please slow down.' }, 429);
  }

  let message: unknown = '';
  let sessionId: string | undefined;
  try {
    const body = (await request.json()) as { message?: unknown; sessionId?: unknown };
    message = body.message;
    sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (typeof message !== 'string') {
    return json({ error: 'Message must be a string.' }, 400);
  }
  const userMessage = message.trim();
  if (!userMessage || userMessage.length > MAX_INPUT) {
    return json({ error: `Message must be 1-${MAX_INPUT} characters.` }, 400);
  }
  if (sessionId !== undefined && !isValidSessionId(sessionId)) {
    return json({ error: 'Invalid session id.' }, 400);
  }

  const resolvedSessionId = sessionId ?? crypto.randomUUID();
  const history = await loadHistory(env.CHAT_KV, resolvedSessionId);

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const result = await env.AI.run(MODEL, { messages, stream: true });
        let full = '';

        if (result instanceof ReadableStream) {
          const decoder = new TextDecoder();
          let buffer = '';
          for await (const chunk of result) {
            buffer += decoder.decode(chunk, { stream: true });
            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload) as { response?: string };
                if (typeof parsed.response === 'string' && parsed.response) {
                  full += parsed.response;
                  send('token', { text: parsed.response });
                }
              } catch {
                // ignore malformed chunks
              }
            }
          }
        } else if (result && typeof result.response === 'string') {
          full = result.response;
          send('token', { text: full });
        }

        const next: ChatMessage[] = history
          .concat(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: full },
          )
          .slice(-HISTORY_LIMIT);
        await saveHistory(env.CHAT_KV, resolvedSessionId, next);

        send('done', { sessionId: resolvedSessionId });
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : 'Inference failed.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
};
