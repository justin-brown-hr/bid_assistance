export const DEFAULT_BID_LANGUAGE = "English";

export const BID_LANGUAGES = [
  "English",
  "German",
  "French",
  "Spanish",
  "Portuguese",
  "Italian",
  "Dutch",
  "Polish",
  "Russian",
  "Ukrainian",
  "Arabic",
  "Hindi",
  "Chinese",
  "Japanese",
  "Korean",
  "Turkish",
  "Romanian",
  "Czech",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Greek",
  "Hungarian",
  "Indonesian",
  "Vietnamese",
  "Thai",
  "Hebrew",
] as const;

export function normalizeBidLanguage(language: string | null | undefined): string {
  const raw = (language || "").trim();
  if (!raw) return DEFAULT_BID_LANGUAGE;
  const match = BID_LANGUAGES.find((l) => l.toLowerCase() === raw.toLowerCase());
  return match ?? DEFAULT_BID_LANGUAGE;
}
