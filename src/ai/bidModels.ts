export const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4.1-mini";

export type BidModelSeed = {
  type: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
};

/** Curated catalog — only models that exist on OpenRouter are kept after sync. */
export const BID_MODEL_SEED: BidModelSeed[] = [
  { type: "openai", modelId: "openai/gpt-4.1-mini", displayName: "GPT-4.1 Mini", enabled: true, sortOrder: 10 },
  { type: "openai", modelId: "openai/gpt-4o-mini", displayName: "GPT-4o Mini", enabled: true, sortOrder: 20 },
  { type: "openai", modelId: "openai/gpt-4.1-nano", displayName: "GPT-4.1 Nano", enabled: true, sortOrder: 30 },
  { type: "openai", modelId: "openai/gpt-5-nano", displayName: "GPT-5 Nano", enabled: true, sortOrder: 40 },
  { type: "openai", modelId: "openai/gpt-4o", displayName: "GPT-4o", enabled: true, sortOrder: 50 },
  { type: "openai", modelId: "openai/o3-mini", displayName: "O3 Mini", enabled: false, sortOrder: 60 },
  { type: "anthropic", modelId: "anthropic/claude-sonnet-4", displayName: "Claude Sonnet 4", enabled: true, sortOrder: 110 },
  { type: "anthropic", modelId: "anthropic/claude-sonnet-4.5", displayName: "Claude Sonnet 4.5", enabled: true, sortOrder: 120 },
  { type: "anthropic", modelId: "anthropic/claude-sonnet-4.6", displayName: "Claude Sonnet 4.6", enabled: true, sortOrder: 130 },
  { type: "anthropic", modelId: "anthropic/claude-haiku-4.5", displayName: "Claude Haiku 4.5", enabled: true, sortOrder: 140 },
  { type: "anthropic", modelId: "anthropic/claude-3-haiku", displayName: "Claude 3 Haiku", enabled: true, sortOrder: 145 },
  { type: "google", modelId: "google/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", enabled: true, sortOrder: 210 },
  { type: "google", modelId: "google/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", enabled: true, sortOrder: 220 },
  { type: "google", modelId: "google/gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite", enabled: true, sortOrder: 230 },
  { type: "google", modelId: "google/gemini-3-flash-preview", displayName: "Gemini 3 Flash Preview", enabled: false, sortOrder: 240 },
  { type: "deepseek", modelId: "deepseek/deepseek-v3.2", displayName: "DeepSeek V3.2", enabled: true, sortOrder: 310 },
  { type: "deepseek", modelId: "deepseek/deepseek-r1", displayName: "DeepSeek R1", enabled: false, sortOrder: 320 },
];
