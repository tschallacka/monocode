import { describe, expect, it } from "vitest";
import type { ClaudeSubagentRun } from "../../../platform/tauri/claudeCodeSessions";
import {
  activeNestedRuns,
  NESTED_RUN_QUIET_MS,
  nestedRunBlock,
  nestedRunId,
} from "./subagentTree";

const now = 10_000_000;

function run(
  agentId: string,
  parentAgentId: string | null,
  extra: Partial<ClaudeSubagentRun> = {},
): ClaudeSubagentRun {
  return {
    agentId,
    toolUseId: `toolu_${agentId}`,
    parentAgentId,
    description: `Work of ${agentId}`,
    agentType: "code-researcher",
    depth: parentAgentId ? 2 : 1,
    finished: false,
    modifiedMs: now - 1_000,
    ...extra,
  };
}

describe("the tree of working subagents", () => {
  it("nests a live run's working subagents, at every depth", () => {
    const tree = activeNestedRuns(
      [
        run("root", null),
        run("child", "root"),
        run("grandchild", "child"),
        run("done", "root", { finished: true }),
        run("quiet", "root", { modifiedMs: now - NESTED_RUN_QUIET_MS }),
      ],
      new Set(["toolu_root"]),
      now,
    );
    expect(tree.get("toolu_root")?.map((r) => r.agentId)).toEqual(["child"]);
    expect(tree.get("toolu_child")?.map((r) => r.agentId)).toEqual([
      "grandchild",
    ]);
    expect(tree.has("toolu_grandchild")).toBe(false);
  });

  it("drops a branch whose root is no longer live", () => {
    const runs = [run("root", null), run("child", "root")];
    expect(activeNestedRuns(runs, new Set(), now).size).toBe(0);
  });

  it("drops a working run under a finished one", () => {
    const tree = activeNestedRuns(
      [
        run("root", null),
        run("child", "root", { finished: true }),
        run("orphan", "child"),
      ],
      new Set(["toolu_root"]),
      now,
    );
    expect(tree.size).toBe(0);
  });

  it("stands a nested run in for an Agent block", () => {
    const block = nestedRunBlock(run("child", "root"), true);
    expect(block).toMatchObject({
      id: nestedRunId("toolu_child"),
      role: "tool",
      text: "Work of child",
      tool: { callId: "toolu_child", kind: "agent", status: "in_progress" },
      agentRun: { name: "code-researcher" },
    });
    expect(nestedRunBlock(run("child", "root"), false).tool?.status).toBe(
      "completed",
    );
  });
});
