/* The scripted builder: a deterministic stand-in for an LLM, used by tests and
   by keyless demos. It speaks OpenAI Chat Completions through OUI's
   scriptedChatCompletions, so the real worker, realtime server, tab runtime,
   room actions, UMF validation and preview all run exactly as with a live
   model; only the decisions are fixed. Given a request to build an app, it
   creates the app, applies the recorded build (fixtures/<script>.build.mjs)
   batch by batch, opens the preview, and summarises. It is labelled
   "scripted" everywhere it shows. */

import { appendFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { conversationOf, messageText, scriptedChatCompletions } from "@ouispec/agent-worker/testing";
// @ts-ignore plain JS fixture
import { BUILD as TIME_TRACKER } from "../../fixtures/time-tracker.build.mjs";

type Msg = { role: string; content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
type Step = { action: string; input: Record<string, unknown>; say?: string };

const builds: Record<string, { match: RegExp; app: { name: string; description: string }; steps: Step[]; summary: string }> = {
  "time-tracker": TIME_TRACKER,
};

let calls = 0;
const callId = () => `call_${Date.now().toString(36)}_${(calls++).toString(36)}`;

export function scriptedModel() {
  const scripted = scriptedChatCompletions((request: any) => {
    const convo = conversationOf(request) as Msg[];
    const lastUser = [...convo].reverse().find((m) => m.role === "user");
    const said = lastUser ? messageText(lastUser as any) : "";
    const since = convo.slice(convo.lastIndexOf(lastUser as Msg) + 1);
    const done = since.filter((m) => m.role === "assistant" && m.tool_calls?.length).length;
    const lastTool = [...since].reverse().find((m) => m.role === "tool");
    const toolText = lastTool ? String(typeof lastTool.content === "string" ? lastTool.content : JSON.stringify(lastTool.content)) : "";

    if (process.env.STUDIO_SCRIPT_LOG) appendFileSync(process.env.STUDIO_SCRIPT_LOG, `${JSON.stringify({ done, roles: since.map((m) => m.role), lastTool: toolText.slice(0, 1500) })}\n`);
    const build = Object.values(builds).find((b) => b.match.test(said));
    if (!build) {
      return { text: "I'm the studio's scripted builder (no AI model is configured), so I can only build the time-tracking app I was recorded with. Ask for a time tracker, or add an ANTHROPIC_API_KEY or OPENAI_API_KEY to apps/studio/.env for a real assistant." };
    }
    if (lastTool && /"ok"\s*:\s*false|"success"\s*:\s*false|INVALID|refused|nothing was saved|did not arrive|not (available|offered|found)|unknown action|"error"\s*:\s*"/i.test(toolText) && done > 0) {
      return { text: `I couldn't finish: the studio refused a step (${toolText.slice(0, 300)}). A real model would fix this and retry; the scripted builder stops here.` };
    }
    const step = build.steps[done];
    if (step) return { text: step.say ?? "", toolCalls: [{ id: callId(), name: "ui_act", args: { action: step.action, input: step.input } }] };
    return { text: build.summary };
  });
  const provider = createOpenAI({ apiKey: "scripted", fetch: scripted.fetch as any });
  return provider.chat("scripted-builder");
}
