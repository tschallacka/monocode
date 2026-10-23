import {
  newSession,
  type Block,
  type Session,
} from "../../../../features/sessions/model/session";
import {
  appendUser,
  applyHarnessEvents,
  stopStreaming,
} from "../../core/apply";
import { isAgentToolName } from "../../core/preview";
import type { HarnessEvent } from "../../core/types";
import {
  artifactTitleField,
  asRecord,
  assistantTextBlocks,
  assistantThinkingBlocks,
  assistantToolUses,
  extractExitPlanModePlan,
  previewFromTool,
  stringField,
  toolKindFromName,
  toolResultsFromUserMessage,
  toolTitle,
} from "./claudeProtocol";

/** One prompt and what Claude did with it, rebuilt from a transcript file. */
export type ClaudeTranscriptTurn = {
  text: string;
  startedAt?: number;
  endedAt?: number;
  events: HarnessEvent[];
};

function recordTime(record: Record<string, unknown>): number | undefined {
  const at = Date.parse(stringField(record, "timestamp") ?? "");
  return Number.isFinite(at) ? at : undefined;
}

/**
 * The words a person typed, or null for a record that is not a prompt: tool
 * results, injected context (`isMeta`), compaction summaries, and the
 * wrappers Claude Code writes for commands, hooks and notifications.
 */
function promptText(record: Record<string, unknown>): string | null {
  if (record.isMeta === true || record.isCompactSummary === true) return null;
  const content = asRecord(record.message)?.content;
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const blocks = content.map(asRecord);
    if (blocks.some((block) => block?.type === "tool_result")) return null;
    text = blocks
      .filter((block) => block?.type === "text")
      .map((block) => String(block?.text ?? ""))
      .join("\n");
  } else {
    return null;
  }
  text = text.trim();
  if (!text || text.startsWith("<")) return null;
  return text;
}

/**
 * A Claude Code transcript's main thread as turns of the events a live Claude
 * session emits, built the way `claude.ts` builds them, so an imported
 * session renders as if it had run here. Records before the first prompt,
 * and sidechain (subagent) records, are left out; `sidechain` reads a
 * subagent's own file, where every record is one.
 */
export function claudeTranscriptTurns(
  records: readonly Record<string, unknown>[],
  { sidechain = false }: { sidechain?: boolean } = {},
): ClaudeTranscriptTurn[] {
  const turns: ClaudeTranscriptTurn[] = [];
  const tools = new Map<
    string,
    { name: string; input: Record<string, unknown>; title: string }
  >();
  let turn: ClaudeTranscriptTurn | null = null;

  for (const record of records) {
    if (record.isSidechain === true && !sidechain) continue;
    const at = recordTime(record);
    if (record.type === "user") {
      const text = promptText(record);
      if (text !== null) {
        turn = { text, startedAt: at, endedAt: at, events: [] };
        turns.push(turn);
        continue;
      }
      if (!turn) continue;
      // Only a tool result belongs to the turn; a command or hook wrapper
      // after it must not stretch the turn's duration.
      const results = toolResultsFromUserMessage(record);
      if (results.length === 0) continue;
      for (const result of results) {
        const tool = tools.get(result.toolUseId);
        if (!tool) continue;
        turn.events.push({
          type: "tool.updated",
          callId: result.toolUseId,
          title: tool.title,
          kind: toolKindFromName(tool.name),
          status: result.isError ? "failed" : "completed",
          detail: result.text || undefined,
          preview: previewFromTool(tool.name, tool.input, result.text),
          ...artifactTitleField(tool.name, tool.input),
        });
      }
      if (at !== undefined) turn.endedAt = at;
      continue;
    }
    if (record.type !== "assistant" || !turn) continue;
    for (const text of assistantThinkingBlocks(record)) {
      if (!text.trim()) continue;
      turn.events.push({ type: "reasoning.delta", text });
      turn.events.push({ type: "reasoning.completed" });
    }
    for (const text of assistantTextBlocks(record)) {
      if (!text) continue;
      turn.events.push({ type: "message.delta", text });
      turn.events.push({ type: "message.completed" });
    }
    for (const use of assistantToolUses(record)) {
      const title = toolTitle(use.name, use.input);
      tools.set(use.id, { name: use.name, input: use.input, title });
      const agentModel = isAgentToolName(use.name)
        ? stringField(use.input, "model")
        : undefined;
      turn.events.push({
        type: "tool.started",
        callId: use.id,
        title,
        kind: toolKindFromName(use.name),
        ...(agentModel ? { agentModel } : {}),
        status: isAgentToolName(use.name) ? "in_progress" : "pending",
        preview: previewFromTool(use.name, use.input),
      });
      if (use.name === "ExitPlanMode") {
        const plan = extractExitPlanModePlan(use.input);
        if (plan) turn.events.push({ type: "plan", text: plan });
      }
    }
    if (at !== undefined) turn.endedAt = at;
  }
  return turns;
}

/**
 * `session` with a transcript's history replayed through the reducer live
 * sessions use, each turn stamped with the times it really ran.
 */
export function withClaudeTranscript(
  session: Session,
  records: readonly Record<string, unknown>[],
  options?: { sidechain?: boolean },
): Session {
  let next = session;
  for (const turn of claudeTranscriptTurns(records, options)) {
    next = appendUser(next, turn.text);
    if (turn.startedAt !== undefined) {
      const startedAt = turn.startedAt;
      next = {
        ...next,
        blocks: next.blocks.map((block, index) =>
          index === next.blocks.length - 1 ? { ...block, startedAt } : block,
        ),
      };
    }
    next = applyHarnessEvents(next, turn.events);
    next = stopStreaming(next, turn.endedAt ?? turn.startedAt);
  }
  return next;
}

/**
 * A subagent's run, from its own transcript, as the blocks a session shows.
 * Its brief, the first prompt, is left out: the view shows it as the header.
 */
export function claudeSubagentBlocks(
  records: readonly Record<string, unknown>[],
): Block[] {
  const run = withClaudeTranscript(newSession("claude", ""), records, {
    sidechain: true,
  });
  return run.blocks[0]?.role === "user" ? run.blocks.slice(1) : run.blocks;
}
