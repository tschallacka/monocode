import { invoke } from "@tauri-apps/api/core";

/** A session started in the Claude Code CLI, as its transcript summarises it. */
export type ClaudeCodeSession = {
  id: string;
  /** The working directory the session ran in, read from its records. */
  cwd: string;
  title: string;
  gitBranch: string | null;
  startedAt: string | null;
  lastAt: string | null;
  /** Epoch ms the transcript was last written. */
  modifiedMs: number;
};

/** The account's Claude Code sessions, newest first. */
export function listClaudeCodeSessions(
  providerAccountId?: string,
  limit?: number,
): Promise<ClaudeCodeSession[]> {
  return invoke<ClaudeCodeSession[]>("claude_code_sessions", {
    providerAccountId,
    limit,
  });
}

/** The main thread's `user` and `assistant` records, in order. */
export function readClaudeCodeTranscript(
  sessionId: string,
  providerAccountId?: string,
): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>("claude_code_transcript", {
    sessionId,
    providerAccountId,
  });
}

/** One subagent run of a Claude session, at any depth. */
export type ClaudeSubagentRun = {
  agentId: string;
  /** The Agent call that spawned it, in its parent's transcript. */
  toolUseId: string;
  /** The run that spawned it; null for one the session spawned itself. */
  parentAgentId: string | null;
  description: string | null;
  agentType: string | null;
  depth: number;
  /** Marked finished by Claude Code; older versions never mark it. */
  finished: boolean;
  /** Epoch ms its transcript was last written. */
  modifiedMs: number;
};

/** Every subagent run the Claude session `sessionId` has started. */
export function listClaudeSubagentRuns(
  sessionId: string,
  providerAccountId?: string,
): Promise<ClaudeSubagentRun[]> {
  return invoke<ClaudeSubagentRun[]>("claude_subagent_runs", {
    sessionId,
    providerAccountId,
  });
}

/**
 * The records of the subagent that Agent call `toolUseId` spawned, read from
 * its own transcript, or null when Claude Code has not written one.
 */
export function readClaudeSubagentTranscript(
  sessionId: string,
  toolUseId: string,
  providerAccountId?: string,
): Promise<Record<string, unknown>[] | null> {
  return invoke<Record<string, unknown>[] | null>(
    "claude_subagent_transcript",
    { sessionId, toolUseId, providerAccountId },
  );
}
