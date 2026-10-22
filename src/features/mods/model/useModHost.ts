import { useCallback, useSyncExternalStore } from "react";
import {
  knownModCommands,
  modHostSnapshot,
  subscribeKnownModCommands,
  subscribeModHost,
  type ModCommand,
  type ModHostSnapshot,
} from "./modHost";

/** What a Claude process last listed, for sessions not running one yet. */
export function useKnownModCommands(): ModCommand[] | null {
  return useSyncExternalStore(subscribeKnownModCommands, knownModCommands);
}

/** A session's mod host, re-rendered on every push; empty without a session. */
export function useModHost(sessionId: string | undefined): ModHostSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessionId ? subscribeModHost(sessionId, listener) : () => {},
    [sessionId],
  );
  return useSyncExternalStore(subscribe, () =>
    modHostSnapshot(sessionId ?? ""),
  );
}
