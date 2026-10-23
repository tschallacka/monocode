import { createContext, useContext, useEffect, useState } from "react";
import { claudeSubagentBlocks } from "../../../integrations/harness/providers/claude/claudeTranscript";
import { readClaudeSubagentTranscript } from "../../../platform/tauri/claudeCodeSessions";
import type { Block, Session } from "../model/session";

/** How often a live run's own transcript is read again. */
const LIVE_RUN_POLL_MS = 2_000;

/** What a transcript can do with one of its session's delegated runs. */
export type SubagentAccess = {
  /** Swap the pane to the run the Agent block `blockId` stands for. */
  enter?: (blockId: string) => void;
  /** The run's full records from its own transcript, or null without one. */
  loadRun?: (callId: string) => Promise<Record<string, unknown>[] | null>;
};

export const SubagentAccessContext = createContext<SubagentAccess>({});

export function useSubagentAccess(): SubagentAccess {
  return useContext(SubagentAccessContext);
}

/**
 * Reads a run's records from Claude Code's own transcript of it, which holds
 * every step and word in full where the mirrored steps are capped. Only a
 * local Claude session has one.
 */
export function subagentRunLoader(
  session: Pick<Session, "harness" | "providerSessionId" | "providerAccountId">,
  local: boolean,
): SubagentAccess["loadRun"] {
  const providerSessionId = session.providerSessionId;
  if (!local || session.harness !== "claude" || !providerSessionId) {
    return undefined;
  }
  return (callId) =>
    readClaudeSubagentTranscript(
      providerSessionId,
      callId,
      session.providerAccountId,
    );
}

/**
 * The run's blocks from its own transcript, read again while it is live, or
 * null while there is none to read and the mirrored steps have to do.
 */
export function useSubagentRunBlocks(
  callId: string | undefined,
  live: boolean,
): Block[] | null {
  const { loadRun } = useSubagentAccess();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  useEffect(() => {
    if (!loadRun || !callId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      loadRun(callId)
        .then((records) => {
          if (cancelled || !records || records.length === 0) return;
          setBlocks(claudeSubagentBlocks(records));
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled && live) timer = setTimeout(read, LIVE_RUN_POLL_MS);
        });
    };
    read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadRun, callId, live]);
  return blocks;
}
