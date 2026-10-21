export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export const IS_WIN =
  typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

export const IS_LINUX =
  typeof navigator !== "undefined" && /Linux/i.test(navigator.platform);

/** Native desktop blur on macOS/Windows; transparency-only glass on Linux. */
export const HAS_NATIVE_GLASS = IS_MAC || IS_WIN || IS_LINUX;

export type KeyboardStyle = "mac" | "pc";

const KEYBOARD_STYLE_KEY = "monocode.keyboardStyle";

/** Only macOS offers a choice; elsewhere the keyboard is always "pc". */
export function loadKeyboardStyle(): KeyboardStyle {
  if (!IS_MAC) return "pc";
  try {
    return localStorage.getItem(KEYBOARD_STYLE_KEY) === "pc" ? "pc" : "mac";
  } catch {
    return "mac";
  }
}

export function saveKeyboardStyle(style: KeyboardStyle) {
  try {
    if (style === "pc") localStorage.setItem(KEYBOARD_STYLE_KEY, "pc");
    else localStorage.removeItem(KEYBOARD_STYLE_KEY);
  } catch {
    throw new Error("Could not save the keyboard style");
  }
}

/**
 * Whether shortcuts follow macOS (Cmd) conventions. Read once at load like
 * IS_MAC, so a style change applies on reload; window chrome stays on IS_MAC.
 */
export const KEYS_MAC = loadKeyboardStyle() === "mac";

/**
 * A Mac on "pc" keys. WKWebView binds no Ctrl clipboard or undo chords, so
 * the app sends those itself.
 */
export const PC_KEYS_ON_MAC = IS_MAC && !KEYS_MAC;

/** CodeMirror's primary modifier; its own `Mod` always follows the real OS. */
export const EDITOR_MOD = KEYS_MAC ? "Mod" : "Ctrl";

export const MOD = KEYS_MAC ? "⌘" : "Ctrl+";
export const ALT = KEYS_MAC ? "⌥" : "Alt+";
export const SHIFT = KEYS_MAC ? "⇧" : "Shift+";
