import { invoke } from "@tauri-apps/api/core";

export type EditAction =
  "copy" | "cut" | "paste" | "undo" | "redo" | "selectAll";

/** Runs the Edit menu's own action on the focused webview (macOS only). */
export function nativeEditAction(action: EditAction) {
  void invoke("native_edit_action", { action }).catch(console.error);
}
