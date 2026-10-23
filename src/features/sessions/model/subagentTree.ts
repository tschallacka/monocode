import type { ClaudeSubagentRun } from "../../../platform/tauri/claudeCodeSessions";
import type { Block } from "./session";

/**
 * A run counts as still working for this long after its transcript was last
 * written, when Claude Code has not marked it finished: older versions never
 * mark it, and a run waiting on a long command writes nothing meanwhile.
 */
export const NESTED_RUN_QUIET_MS = 5 * 60_000;

/** The id a nested run is viewed under; it has no block of the session's own. */
export function nestedRunId(callId: string): string {
  return `run:${callId}`;
}

export function isNestedRunId(id: string): boolean {
  return id.startsWith("run:");
}

/** A nested run as the Agent block the transcript and the dock read. */
export function nestedRunBlock(run: ClaudeSubagentRun, live: boolean): Block {
  const name = run.agentType ?? "subagent";
  const brief = run.description ?? name;
  return {
    id: nestedRunId(run.toolUseId),
    role: "tool",
    text: brief,
    tool: {
      callId: run.toolUseId,
      kind: "agent",
      title: brief,
      status: live ? "in_progress" : "completed",
    },
    agentRun: { name, agentType: name, steps: [] },
  };
}

function working(run: ClaudeSubagentRun, now: number): boolean {
  return !run.finished && now - run.modifiedMs < NESTED_RUN_QUIET_MS;
}

/**
 * The runs still working under the session's live runs, keyed by the Agent
 * call of the run that spawned them. A run is only listed while every run
 * above it is too, so a finished branch drops out whole.
 */
export function activeNestedRuns(
  runs: readonly ClaudeSubagentRun[],
  liveRootCallIds: ReadonlySet<string>,
  now: number,
): Map<string, ClaudeSubagentRun[]> {
  const byParent = new Map<string, ClaudeSubagentRun[]>();
  for (const run of runs) {
    if (!run.parentAgentId) continue;
    const siblings = byParent.get(run.parentAgentId) ?? [];
    siblings.push(run);
    byParent.set(run.parentAgentId, siblings);
  }
  const active = new Map<string, ClaudeSubagentRun[]>();
  const visit = (parent: ClaudeSubagentRun, seen: Set<string>) => {
    if (seen.has(parent.agentId)) return;
    seen.add(parent.agentId);
    const children = (byParent.get(parent.agentId) ?? [])
      .filter((child) => working(child, now))
      .sort((a, b) => a.modifiedMs - b.modifiedMs);
    if (children.length === 0) return;
    active.set(parent.toolUseId, children);
    for (const child of children) visit(child, seen);
  };
  for (const run of runs) {
    if (liveRootCallIds.has(run.toolUseId)) visit(run, new Set());
  }
  return active;
}
