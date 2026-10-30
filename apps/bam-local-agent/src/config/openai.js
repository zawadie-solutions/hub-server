import OpenAI from 'openai';

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
export const OPENAI_TIMEOUT_MS = 60_000;

// BAM_OPENAI_API_KEY lets this app use its own key inside the Zawadie hub, whose OPENAI_API_KEY other apps share;
// standalone, OPENAI_API_KEY from this app's .env is used as before.
export const OPENAI_API_KEY = process.env.BAM_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

// Server-side only. The key never leaves this process.
export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: OPENAI_TIMEOUT_MS,
  maxRetries: 1
});
