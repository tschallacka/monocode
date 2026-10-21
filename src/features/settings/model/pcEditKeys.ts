import type { EditAction } from "../../../platform/tauri/editActions";

type EditKeyEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing"
>;

export type EditTarget = "terminal" | "editor" | "field" | "other";

const PLAIN_ACTIONS: Record<string, EditAction> = {
  KeyC: "copy",
  KeyX: "cut",
  KeyV: "paste",
  KeyZ: "undo",
  KeyY: "redo",
  KeyA: "selectAll",
};

export function editTargetOf(element: Element | null): EditTarget {
  if (!element) return "other";
  if (element.closest(".monocode-terminal")) return "terminal";
  if (element.closest(".cm-editor")) return "editor";
  if (
    element.closest("input, textarea") ||
    (element as HTMLElement).isContentEditable
  ) {
    return "field";
  }
  return "other";
}

/**
 * The Windows/Linux edit chord a key press stands for on "pc" keys, or null.
 * The terminal and CodeMirror bind their own chords; other content can only
 * be copied from, and only while text is selected.
 */
export function pcEditAction(
  event: EditKeyEvent,
  target: EditTarget,
  hasSelection: boolean,
): EditAction | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null;
  }
  if (target === "terminal") return null;
  const action = event.shiftKey
    ? event.code === "KeyZ"
      ? "redo"
      : null
    : (PLAIN_ACTIONS[event.code] ?? null);
  if (!action) return null;
  if (target === "field") return action;
  if (target === "editor") {
    return action === "copy" || action === "cut" || action === "paste"
      ? action
      : null;
  }
  return action === "copy" && hasSelection ? action : null;
}
