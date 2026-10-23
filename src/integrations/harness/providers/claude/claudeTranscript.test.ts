import { describe, expect, it } from "vitest";
import { newSession } from "../../../../features/sessions/model/session";
import {
  claudeTranscriptTurns,
  withClaudeTranscript,
} from "./claudeTranscript";

/** Records as a Claude Code transcript file holds them, one per line. */
const records: Record<string, unknown>[] = [
  {
    type: "user",
    isMeta: true,
    timestamp: "2026-10-22T08:00:00.000Z",
    message: { role: "user", content: "Skill body injected by Claude Code" },
  },
  {
    type: "user",
    timestamp: "2026-10-22T08:00:01.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "Fix the cart total" }],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-10-22T08:00:02.000Z",
    message: {
      id: "msg_1",
      content: [{ type: "thinking", thinking: "Look at the cart first." }],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-10-22T08:00:03.000Z",
    message: {
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { file_path: "/shop/cart.php" },
        },
      ],
    },
  },
  {
    type: "assistant",
    isSidechain: true,
    timestamp: "2026-10-22T08:00:04.000Z",
    message: {
      id: "msg_side",
      content: [{ type: "text", text: "subagent chatter" }],
    },
  },
  {
    type: "user",
    timestamp: "2026-10-22T08:00:05.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "<?php // cart",
        },
      ],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-10-22T08:00:09.000Z",
    message: {
      id: "msg_2",
      content: [{ type: "text", text: "Fixed the rounding." }],
    },
  },
  {
    type: "user",
    timestamp: "2026-10-22T08:01:00.000Z",
    message: { role: "user", content: "<command-name>/clear</command-name>" },
  },
];

describe("Claude Code transcript import", () => {
  it("rebuilds the prompt and what Claude did as live events", () => {
    const turns = claudeTranscriptTurns(records);
    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn.text).toBe("Fix the cart total");
    expect(turn.startedAt).toBe(Date.parse("2026-10-22T08:00:01.000Z"));
    expect(turn.endedAt).toBe(Date.parse("2026-10-22T08:00:09.000Z"));
    expect(turn.events.map((event) => event.type)).toEqual([
      "reasoning.delta",
      "reasoning.completed",
      "tool.started",
      "tool.updated",
      "message.delta",
      "message.completed",
    ]);
    expect(turn.events[3]).toMatchObject({
      type: "tool.updated",
      callId: "toolu_1",
      status: "completed",
      detail: "<?php // cart",
    });
  });

  it("replays into the blocks a live session shows, with real timings", () => {
    const session = withClaudeTranscript(
      newSession("claude", "/shop"),
      records,
    );
    expect(session.busy).toBe(false);
    expect(session.blocks.map((block) => block.role)).toEqual([
      "user",
      "reasoning",
      "tool",
      "assistant",
    ]);
    const [prompt, , tool, reply] = session.blocks;
    expect(prompt.startedAt).toBe(Date.parse("2026-10-22T08:00:01.000Z"));
    expect(prompt.durationMs).toBe(8_000);
    expect(tool.tool).toMatchObject({ callId: "toolu_1", status: "completed" });
    expect(reply.text).toBe("Fixed the rounding.");
    expect(session.blocks.every((block) => !block.streaming)).toBe(true);
  });

  it("leaves out records that come before any prompt", () => {
    expect(
      claudeTranscriptTurns([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "orphan" }] },
        },
      ]),
    ).toEqual([]);
  });
});
