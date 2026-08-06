/// <reference types="astro/client" />

interface AiTextGenInput {
  messages: { role: string; content: string }[];
  stream?: boolean;
}

interface AiTextGenResult {
  response?: string;
  [key: string]: unknown;
}

interface Env {
  AI: {
    run: (
      model: string,
      input: AiTextGenInput,
    ) => Promise<ReadableStream<Uint8Array> | AiTextGenResult>;
  };
  CHAT_KV: KVNamespace;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      ctx: ExecutionContext;
      cf: Record<string, unknown>;
    };
  }
}
