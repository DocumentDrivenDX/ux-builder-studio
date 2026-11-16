/* The agent's model, provider-neutral: any `ai` SDK model. Chosen by
   STUDIO_MODEL ("anthropic:<model>", "openai:<model>", "ollama:<model>",
   "scripted"), defaulting to Anthropic when ANTHROPIC_API_KEY is set, then
   OpenAI when OPENAI_API_KEY is set, else the scripted model (a fixed,
   recorded-style builder used for tests and keyless demos; it is not an LLM). */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { PROMPT_CACHE_BREAKPOINTS } from "@ouispec/agent-worker";
import { scriptedModel } from "./scripted.js";

export function pickModel(): { model: any; extras: Record<string, unknown>; label: string } {
  const choice =
    process.env.STUDIO_MODEL ??
    (process.env.ANTHROPIC_API_KEY ? "anthropic:claude-opus-5-5" : process.env.OPENAI_API_KEY ? "openai:gpt-4.1" : "scripted");
  const [provider, ...rest] = choice.split(":");
  const id = rest.join(":");
  if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Current Claude models reject forced tool choice and sampling parameters.
    return { model: anthropic(id || "claude-opus-5-5"), extras: { promptCacheBreakpoint: PROMPT_CACHE_BREAKPOINTS.anthropic, forcedToolChoice: false, temperature: null, maxTokens: 32000 }, label: `anthropic:${id || "claude-opus-5-5"}` };
  }
  if (provider === "openai") {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return { model: openai.chat(id || "gpt-4.1"), extras: {}, label: `openai:${id || "gpt-4.1"}` };
  }
  if (provider === "ollama") {
    const ollama = createOpenAI({ baseURL: process.env.OLLAMA_URL ?? "http://localhost:11434/v1", apiKey: "ollama" });
    return { model: ollama.chat(id), extras: { forcedToolChoice: false }, label: `ollama:${id}` };
  }
  return { model: scriptedModel(), extras: {}, label: "scripted" };
}

export function describeModel(label: string) {
  if (label === "scripted") return "Scripted builder (no API key set): a fixed sequence that builds the time tracker, for tests and demos. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in apps/studio/.env for a real model.";
  return `Model: ${label}`;
}
