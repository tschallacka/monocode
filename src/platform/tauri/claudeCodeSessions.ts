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
