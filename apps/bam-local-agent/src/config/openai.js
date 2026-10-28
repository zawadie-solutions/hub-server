import OpenAI from 'openai';

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
export const OPENAI_TIMEOUT_MS = 60_000;

// Server-side only. The key never leaves this process.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: OPENAI_TIMEOUT_MS,
  maxRetries: 1
});
