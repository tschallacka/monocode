import { useCallback, useEffect, useState } from "react";
import {
  claudeMcpStatus,
  reconnectClaudeMcpServer,
} from "../../../integrations/harness";
import { CLAUDE_CHROME_SERVER } from "../../../integrations/harness/providers/claude/claudeProtocol";
import { chromeLinkSummary, type ChromeLink } from "../model/chromeCommand";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * MonoCode's `/chrome`: the session's link to the Claude in Chrome
 * extension, read from its running Claude process, and a reconnect that
 * restarts that link the way Claude Code's own `/chrome` does.
 */
export function ChromePanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<ChromeLink>({ kind: "loading" });
  const [reconnecting, setReconnecting] = useState(false);

  const refresh = useCallback(() => {
    setLink({ kind: "loading" });
    claudeMcpStatus(sessionId).then(
      (servers) =>
        setLink(
          servers === null
            ? { kind: "idle" }
            : {
                kind: "ready",
                server:
                  servers.find((s) => s.name === CLAUDE_CHROME_SERVER) ?? null,
              },
        ),
      (error: unknown) => setLink({ kind: "error", message: reason(error) }),
    );
  }, [sessionId]);

  useEffect(refresh, [refresh]);

  const reconnect = () => {
    setReconnecting(true);
    reconnectClaudeMcpServer(sessionId, CLAUDE_CHROME_SERVER)
      .then(
        (server) =>
          setLink(
            server === null ? { kind: "idle" } : { kind: "ready", server },
          ),
        (error: unknown) => setLink({ kind: "error", message: reason(error) }),
      )
      .finally(() => setReconnecting(false));
  };

  const summary = chromeLinkSummary(link);
  const canReconnect = link.kind === "ready" || link.kind === "error";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/30 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div
        role="dialog"
        aria-label="Claude in Chrome"
        className="flex h-fit w-[min(520px,92vw)] flex-col gap-3 rounded-xl border border-stroke bg-background-base p-4 font-sans text-sm text-content shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium">Claude in Chrome</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-content/60 hover:bg-content/8 hover:text-content"
          >
            Close
          </button>
        </div>
        <p
          role="status"
          className={summary.ok ? "text-emerald-400/90" : "text-content/75"}
        >
          {reconnecting ? "Reconnecting…" : summary.text}
        </p>
        {summary.ok || link.kind === "loading" ? null : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[12px] text-content/55">
            <li>
              Chrome is running, and the extension is on in chrome://extensions.
            </li>
            <li>
              The extension is signed in to the same claude.ai organization as
              this session&apos;s Claude account.
            </li>
            <li>Still nothing after a reconnect: restart Chrome.</li>
          </ul>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canReconnect || reconnecting}
            onClick={reconnect}
            className="rounded-md border border-stroke px-3 py-1.5 text-[12px] hover:bg-content/8 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            Reconnect extension
          </button>
          <button
            type="button"
            disabled={reconnecting}
            onClick={refresh}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-50"
          >
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}
