import { useSyncExternalStore } from "react";
import type { RuntimeMode } from "./session";

const DEFAULT_RUNTIME_MODE_KEY = "monocode.defaultRuntimeMode";
const DEFAULT_RUNTIME_MODE_EVENT = "monocode:defaultruntimemodechange";

/**
 * The mode a new session starts in until Settings says otherwise: auto, where
 * an AI reviewer approves routine actions rather than asking about each one.
 */
export const NEW_SESSION_RUNTIME_MODE: RuntimeMode = "auto";

const KNOWN_MODES: ReadonlySet<string> = new Set<RuntimeMode>([
  "supervised",
  "auto-accept-edits",
  "auto",
  "full-access",
]);

/** The permission mode new sessions start in. Existing sessions keep theirs. */
export function loadDefaultRuntimeMode(): RuntimeMode {
  try {
    const saved = localStorage.getItem(DEFAULT_RUNTIME_MODE_KEY);
    if (saved && KNOWN_MODES.has(saved)) return saved as RuntimeMode;
  } catch {
    // No storage (tests, private mode): fall back to the default.
  }
  return NEW_SESSION_RUNTIME_MODE;
}

export function saveDefaultRuntimeMode(mode: RuntimeMode): void {
  try {
    localStorage.setItem(DEFAULT_RUNTIME_MODE_KEY, mode);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DEFAULT_RUNTIME_MODE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEFAULT_RUNTIME_MODE_KEY || event.key === null)
      onChange();
  };
  window.addEventListener(DEFAULT_RUNTIME_MODE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEFAULT_RUNTIME_MODE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDefaultRuntimeMode(): RuntimeMode {
  return useSyncExternalStore(
    subscribe,
    loadDefaultRuntimeMode,
    () => NEW_SESSION_RUNTIME_MODE,
  );
}
