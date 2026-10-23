import { describe, expect, it } from "vitest";
import type { ClaudeCodeSession } from "../../../platform/tauri/claudeCodeSessions";
import { filterClaudeCodeSessions } from "../ui/ClaudeCodeSessionPicker";
import {
  CLAUDE_CODE_LIVE_MS,
  claudeCodeSessionFor,
  isLikelyLive,
} from "./claudeCodeImport";

const source: ClaudeCodeSession = {
  id: "1d9653bf-b45a-4fec-a7b5-54f7b46f0e80",
  cwd: "/Users/me/www/dugros",
  title: "Cart total fix",
  gitBranch: "feature/cart",
  startedAt: "2026-10-22T08:00:00.000Z",
  lastAt: "2026-10-22T08:05:00.000Z",
  modifiedMs: 1_000_000,
};

describe("picking up a Claude Code session", () => {
  it("opens it as a Claude session that resumes the same conversation", () => {
    const session = claudeCodeSessionFor(source, [
      {
        type: "user",
        timestamp: "2026-10-22T08:00:00.000Z",
        message: { content: "Fix the cart total" },
      },
      {
        type: "assistant",
        timestamp: "2026-10-22T08:00:04.000Z",
        message: { id: "m1", content: [{ type: "text", text: "Done." }] },
      },
    ]);
    expect(session).toMatchObject({
      id: source.id,
      harness: "claude",
      cwd: "/Users/me/www/dugros",
      title: "Cart total fix",
      providerSessionId: source.id,
      busy: false,
    });
    expect(session.blocks.map((block) => block.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("warns about a transcript written within the last minute", () => {
    expect(
      isLikelyLive(source, source.modifiedMs + CLAUDE_CODE_LIVE_MS - 1),
    ).toBe(true);
    expect(isLikelyLive(source, source.modifiedMs + CLAUDE_CODE_LIVE_MS)).toBe(
      false,
    );
  });

  it("finds sessions by every word across title, folder and branch", () => {
    const other: ClaudeCodeSession = {
      ...source,
      id: "other",
      title: "Release notes",
      cwd: "/Users/me/git/monocode",
      gitBranch: null,
    };
    const all = [source, other];
    expect(filterClaudeCodeSessions(all, "")).toEqual(all);
    expect(filterClaudeCodeSessions(all, "dugros cart")).toEqual([source]);
    expect(filterClaudeCodeSessions(all, "MONOCODE release")).toEqual([other]);
    expect(filterClaudeCodeSessions(all, "cart monocode")).toEqual([]);
  });
});
