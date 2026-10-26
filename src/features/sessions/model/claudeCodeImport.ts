import {
  readClaudeCodeTranscript,
  type ClaudeCodeSession,
} from "../../../platform/tauri/claudeCodeSessions";
import { withClaudeTranscript } from "../../../integrations/harness/providers/claude/claudeTranscript";
import { readSession, upsertSession } from "../data/sessionStore";
import { newSession, type Session } from "./session";

/**
 * Opens the Claude Code session picker. With a `cwd` it lists that project's
 * sessions; without one it lists every session, and picking one also adds
 * its folder as a project.
 */
export const OPEN_CLAUDE_CODE_SESSION_EVENT = "monocode:open-claude-code-session";

export type OpenClaudeCodeSessionDetail = { cwd?: string };

export function openClaudeCodeSessionPicker(cwd?: string) {
  window.dispatchEvent(
    new CustomEvent<OpenClaudeCodeSessionDetail>(OPEN_CLAUDE_CODE_SESSION_EVENT, {
      detail: { cwd },
    }),
  );
}

/** A transcript written this recently may still be running in a terminal. */
export const CLAUDE_CODE_LIVE_MS = 60_000;

export function isLikelyLive(session: ClaudeCodeSession, now = Date.now()) {
  return now - session.modifiedMs < CLAUDE_CODE_LIVE_MS;
}

/**
 * A MonoCode session for a Claude Code CLI session: its working directory,
 * its title, its history as transcript blocks, and the Claude session id so
 * the next message resumes the same conversation. Keyed by that id, so
 * picking the same session again finds the one imported before.
 */
export function claudeCodeSessionFor(
  source: ClaudeCodeSession,
  records: readonly Record<string, unknown>[],
): Session {
  const base: Session = {
    ...newSession("claude", source.cwd),
    id: source.id,
    title: source.title,
    providerSessionId: source.id,
  };
  return withClaudeTranscript(base, records);
}

/** Imports the session once and answers the MonoCode session id to open. */
export async function importClaudeCodeSession(
  source: ClaudeCodeSession,
): Promise<string> {
  if (await readSession(source.id)) return source.id;
  const records = await readClaudeCodeTranscript(source.id);
  await upsertSession(claudeCodeSessionFor(source, records));
  return source.id;
}
