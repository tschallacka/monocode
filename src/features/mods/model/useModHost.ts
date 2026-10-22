import { useCallback, useSyncExternalStore } from "react";
import {
  modHostSnapshot,
  subscribeModHost,
  type ModHostSnapshot,
} from "./modHost";

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
