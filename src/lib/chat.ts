export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export const HISTORY_LIMIT = 10;

const key = (id: string) => `chat:${id}`;

export function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.role === 'user' || v.role === 'assistant') && typeof v.content === 'string'
  );
}

export function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

export async function loadHistory(kv: KVNamespace, id: string): Promise<ChatMessage[]> {
  const raw = await kv.get(key(id));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isMessage).slice(-HISTORY_LIMIT);
    }
  } catch {
    // fall through to empty history
  }
  return [];
}

export function saveHistory(kv: KVNamespace, id: string, messages: ChatMessage[]): Promise<void> {
  return kv.put(key(id), JSON.stringify(messages));
}
