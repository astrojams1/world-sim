export const ALLOWED_MODELS = ["gpt-5-mini", "gpt-5.4-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"] as const;
export type ModelId = (typeof ALLOWED_MODELS)[number];
export const DEFAULT_MODEL: ModelId = "gpt-5-mini";
