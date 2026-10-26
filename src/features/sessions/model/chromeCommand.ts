import type { ClaudeMcpServerStatus } from "../../../integrations/harness/providers/claude/claudeProtocol";
import type { BuiltinSkill } from "../../skills/model/skills";

/**
 * Claude Code's `/chrome`, which the CLI only offers in its own terminal UI:
 * a stream-json session answers it with "isn't available in this
 * environment". MonoCode shows the session's Chrome connection itself.
 */
export const CHROME_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "chrome",
  invocation: "chrome",
  description: "Check or reconnect this session's Claude in Chrome link.",
  scope: "builtin",
  source: "monocode",
};

export function isChromeCommand(text: string): boolean {
  return /^\s*\/chrome\s*$/i.test(text);
}

/** What the Chrome panel knows about the session's link to the extension. */
export type ChromeLink =
  | { kind: "loading" }
  /** No Claude process runs for the session yet. */
  | { kind: "idle" }
  /** The process's Chrome server, or null when it has none. */
  | { kind: "ready"; server: ClaudeMcpServerStatus | null }
  | { kind: "error"; message: string };

/** The panel's status line and whether the link works. */
export function chromeLinkSummary(link: ChromeLink): {
  text: string;
  ok: boolean;
} {
  switch (link.kind) {
    case "loading":
      return { text: "Asking Claude…", ok: false };
    case "idle":
      return {
        text: "Claude is not running for this session yet. Chrome connects when you send the next message.",
        ok: false,
      };
    case "error":
      return {
        text: `Claude did not report its status: ${link.message}`,
        ok: false,
      };
    case "ready": {
      const server = link.server;
      if (!server) {
        return {
          text: "Claude in Chrome is not enabled for this session.",
          ok: false,
        };
      }
      if (server.status === "connected") {
        return {
          text: `Connected, ${server.tools} browser ${server.tools === 1 ? "tool" : "tools"} available.`,
          ok: true,
        };
      }
      const reason = server.error ? `: ${server.error}` : "";
      const label =
        server.status === "disabled"
          ? "Disconnected"
          : server.status === "pending"
            ? "Connecting"
            : server.status === "failed"
              ? "Not connected"
              : server.status;
      return { text: `${label}${reason}.`, ok: false };
    }
  }
}
