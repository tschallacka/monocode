import { useEffect, useMemo, useRef, useState } from "react";
import {
  listClaudeCodeSessions,
  type ClaudeCodeSession,
} from "../../../platform/tauri/claudeCodeSessions";
import { homeDir } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { isLikelyLive } from "../model/claudeCodeImport";

function shortPath(path: string, home: string | null): string {
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}

function ago(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Sessions whose title, folder or branch hold every word of the query. */
export function filterClaudeCodeSessions(
  sessions: readonly ClaudeCodeSession[],
  query: string,
): ClaudeCodeSession[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...sessions];
  return sessions.filter((session) => {
    const haystack =
      `${session.title} ${session.cwd} ${session.gitBranch ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Sessions that ran in `folder` or a folder below it. */
export function claudeCodeSessionsIn(
  sessions: readonly ClaudeCodeSession[],
  folder: string,
): ClaudeCodeSession[] {
  const key = pathKey(folder);
  return sessions.filter((session) => {
    const cwd = pathKey(session.cwd);
    return cwd === key || cwd.startsWith(`${key}/`);
  });
}

/** Picks a Claude Code CLI session to continue in MonoCode. */
export function ClaudeCodeSessionPicker({
  cwd,
  onPick,
  onClose,
}: {
  /** Lists only the sessions run in this project folder. */
  cwd?: string;
  /** Imports and opens the session; the picker waits on it. */
  onPick: (session: ClaudeCodeSession) => Promise<void>;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<ClaudeCodeSession[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const now = useMemo(() => Date.now(), [sessions]);

  useEffect(() => {
    let cancelled = false;
    listClaudeCodeSessions()
      .then(
        (found) =>
          !cancelled && setSessions(cwd ? claudeCodeSessionsIn(found, cwd) : found),
      )
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    homeDir()
      .then((dir) => !cancelled && setHome(dir))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const pick = (session: ClaudeCodeSession) => {
    if (opening) return;
    setOpening(session.id);
    setError(null);
    onPick(session).catch((reason: unknown) => {
      setOpening(null);
      setError(String(reason));
    });
  };

  const shown = useMemo(
    () => filterClaudeCodeSessions(sessions ?? [], query),
    [sessions, query],
  );
  useEffect(() => setActive(0), [query]);
  useEffect(
    () => activeRef.current?.scrollIntoView({ block: "nearest" }),
    [active],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && shown[active]) {
      event.preventDefault();
      pick(shown[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Open Claude Code session"
        className="flex h-fit max-h-[70vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl border border-stroke bg-background-base shadow-2xl"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={
            cwd
              ? `Search Claude Code sessions in ${shortPath(cwd, home)}`
              : "Search Claude Code sessions by title, folder or branch"
          }
          aria-label="Search Claude Code sessions"
          className="h-11 shrink-0 border-b border-stroke bg-transparent px-4 text-sm text-content outline-none placeholder:text-content/40"
        />
        <div
          role="listbox"
          aria-label="Claude Code sessions"
          className="min-h-0 overflow-y-auto p-1.5"
        >
          {error ? (
            <p className="px-2 py-3 text-[13px] text-red-400/90">{error}</p>
          ) : sessions === null ? (
            <p className="px-2 py-3 text-[13px] text-content/50">
              Reading Claude Code sessions…
            </p>
          ) : shown.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-content/50">
              {sessions.length > 0
                ? "No session matches."
                : cwd
                  ? "No Claude Code sessions ran in this project."
                  : "No Claude Code sessions found."}
            </p>
          ) : (
            shown.map((session, index) => {
              const highlighted = index === active;
              const live = isLikelyLive(session, now);
              return (
                <button
                  key={session.id}
                  ref={highlighted ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(session)}
                  disabled={!!opening && opening !== session.id}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left ${
                    highlighted ? "bg-selection" : ""
                  }`}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-content">
                      {session.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-content/45">
                      {opening === session.id
                        ? "Opening…"
                        : ago(session.modifiedMs, now)}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-2 text-[11px] text-content/50">
                    <span className="min-w-0 truncate font-mono">
                      {shortPath(session.cwd, home)}
                    </span>
                    {session.gitBranch ? (
                      <span className="shrink-0 truncate">
                        ⎇ {session.gitBranch}
                      </span>
                    ) : null}
                    {live ? (
                      <span className="shrink-0 text-amber-400/90">
                        may still be running in a terminal
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
