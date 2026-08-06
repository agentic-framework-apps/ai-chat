# ShortChat — free AI chat

A minimal AI chat app built with [Astro](https://astro.build) and deployed on
[Cloudflare Workers](https://developers.cloudflare.com/workers/). Responses are
streamed token-by-token with **Server-Sent Events**, and each conversation is
persisted in Cloudflare **Workers KV** so sessions remember context.

Live at: <https://ai-chat.aichatcf.workers.dev>

## Features

- Streaming responses via SSE (`event: token` chunks, then `event: done`)
- Per-session conversation memory in Workers KV (last 10 turns)
- Anonymous sessions — a `sessionId` UUID is generated on first message
- Per-IP rate limiting (`cf-connecting-ip`): 30 messages/minute, 200 messages/day
- No server to manage, no database to run

## How it works

| Component | Responsibility |
|---|---|
| `src/pages/api/chat.ts` | `POST /api/chat` — loads history, streams inference over SSE, persists the updated history |
| `src/lib/chat.ts` | KV read/write helpers, message/session validation, history bounds |
| `src/components/Chat.astro` | Client-side chat UI island on the landing page |

The model is [`@cf/meta/llama-3.2-3b-instruct`](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct)
via the Worker's `AI` binding (`env.AI.run(MODEL, { messages, stream: true })`).

Routes are on-demand (`prerender = false`); the landing page is a static asset
served by the Worker's assets binding.

## API

### Send a message

```http
POST /api/chat
Content-Type: application/json

{ "message": "What is the capital of France?" }
```

Omit `sessionId` to start a new session; include it to continue one.

Response `200` is a `text/event-stream`:

```
event: token
data: {"text":"Paris"}

event: token
data: {"text":"."}

event: done
data: {"sessionId":"6e046076-2e1c-4dce-b1a4-35ccde6e2dcd"}
```

The client reuses the `sessionId` from `done` on subsequent requests to keep the
conversation going. On failure an `event: error` is emitted with the message.

Errors (`400`): non-string message, empty/over-length message, or malformed
session id.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm run check        # astro check
npm run build        # builds to dist/
```

## Deploying

Requires a Cloudflare account with a Workers API token that has access to
Workers AI (or `wrangler login`).

1. Create a KV namespace and put its ID in the `CHAT_KV` binding in
   `wrangler.jsonc` (point the `SESSION` binding at the same namespace — the
   `@astrojs/cloudflare` adapter requires it).
2. Deploy:

```bash
npm run deploy       # wrangler deploy
```

The worker is configured with `workers_dev: true`, so it is published to
`https://ai-chat.<your-subdomain>.workers.dev`.

## Costs

Workers AI has a generous free daily allowance on the free plan. The 3B model
keeps token usage (and cost) low; see
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
for details.
