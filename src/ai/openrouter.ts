import crypto from "node:crypto";
import OpenAI from "openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export { OPENROUTER_DEFAULT_MODEL } from "./bidModels.js";

export type OpenRouterKeyRow = {
  id: number;
  key: string;
};

export type OpenRouterKeyStore = {
  getActiveKeys(): OpenRouterKeyRow[];
  markExhausted(id: number, error: string): void;
};

export function maskApiKey(key: string): string {
  const t = key.trim();
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

export function isKeyExhaustedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string; error?: { message?: string; code?: string } };
  const status = e.status;
  if (status === 401 || status === 402 || status === 403) return true;
  const msg = String(e.message ?? e.error?.message ?? e.error?.code ?? "").toLowerCase();
  return /credit|quota|insufficient|balance|exhausted|billing|payment|invalid.*key|deactivated/.test(msg);
}

export function createOpenRouterClient(apiKey: string, baseUrl = OPENROUTER_BASE_URL): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
  });
}

export async function fetchOpenRouterModelIds(baseUrl = OPENROUTER_BASE_URL): Promise<Set<string>> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const res = await fetch(url, { headers: { "User-Agent": "FreelancerHelper/1.0" } });
  if (!res.ok) throw new Error(`OpenRouter models list failed: ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return new Set((json.data ?? []).map((m) => m.id));
}

export async function openRouterChatCompletion(opts: {
  store: OpenRouterKeyStore;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  temperature?: number;
  baseUrl?: string;
}): Promise<string> {
  const keys = opts.store.getActiveKeys();
  if (keys.length === 0) {
    throw new Error("No active OpenRouter API keys — add keys on the Admin page");
  }

  let lastError: Error | null = null;
  for (const row of keys) {
    try {
      const client = createOpenRouterClient(row.key, opts.baseUrl);
      const resp = await client.chat.completions.create({
        model: opts.model,
        temperature: opts.temperature ?? 0.3,
        messages: opts.messages,
      });
      const text = resp.choices[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("Empty response from OpenRouter");
      return text.trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isKeyExhaustedError(err)) {
        opts.store.markExhausted(row.id, lastError.message);
        console.warn(`[openrouter] Key #${row.id} marked exhausted: ${lastError.message}`);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("All OpenRouter API keys are exhausted — add new keys on the Admin page");
}
