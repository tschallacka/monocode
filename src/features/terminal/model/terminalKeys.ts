type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/** Translate macOS editing shortcuts into sequences understood by common shells. */
export function macTerminalShortcutData(
  event: TerminalKeyEvent,
): string | null {
  if (event.ctrlKey || event.shiftKey) return null;

  if (event.altKey && !event.metaKey) {
    if (event.key === "ArrowLeft") return "\x1bb";
    if (event.key === "ArrowRight") return "\x1bf";
    return null;
  }

  if (event.metaKey && !event.altKey) {
    if (event.key === "ArrowLeft") return "\x01";
    if (event.key === "ArrowRight") return "\x05";
    if (event.key === "Backspace") return "\x15";
  }

  return null;
}

/**
 * Windows/Linux terminal clipboard chords for a Mac on "pc" keys: Ctrl+C copies
 * only a selection, otherwise it stays the shell's interrupt.
 */
export function pcTerminalEditAction(
  event: TerminalKeyEvent,
  hasSelection: boolean,
): "copy" | "paste" | null {
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "c" && (event.shiftKey || hasSelection)) return "copy";
  if (key === "v") return "paste";
  return null;
}

/**
 * Whether a key press is the macOS Cmd+K clear. It only reaches the terminal
 * when "App: Search" is disabled or rebound, since the app claims it first.
 */
export function isMacTerminalClearShortcut(event: TerminalKeyEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}
