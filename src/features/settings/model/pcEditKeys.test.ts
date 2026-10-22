import { describe, expect, it } from "vitest";
import { pcEditAction } from "./pcEditKeys";

function key(
  code: string,
  modifiers: Partial<
    Pick<
      KeyboardEvent,
      "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing"
    >
  > = {},
) {
  return {
    code,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...modifiers,
  };
}

describe("pc edit chords", () => {
  it("maps every Windows edit chord in a text field", () => {
    expect(pcEditAction(key("KeyC"), "field", false)).toBe("copy");
    expect(pcEditAction(key("KeyX"), "field", false)).toBe("cut");
    expect(pcEditAction(key("KeyV"), "field", false)).toBe("paste");
    expect(pcEditAction(key("KeyZ"), "field", false)).toBe("undo");
    expect(pcEditAction(key("KeyY"), "field", false)).toBe("redo");
    expect(pcEditAction(key("KeyZ", { shiftKey: true }), "field", false)).toBe(
      "redo",
    );
    expect(pcEditAction(key("KeyA"), "field", false)).toBe("selectAll");
  });

  it("leaves the terminal and the editor's own keymap alone", () => {
    expect(pcEditAction(key("KeyC"), "terminal", true)).toBe(null);
    expect(pcEditAction(key("KeyV"), "editor", false)).toBe("paste");
    expect(pcEditAction(key("KeyZ"), "editor", false)).toBe(null);
    expect(pcEditAction(key("KeyA"), "editor", false)).toBe(null);
  });

  it("only copies a selection from other content", () => {
    expect(pcEditAction(key("KeyC"), "other", true)).toBe("copy");
    expect(pcEditAction(key("KeyC"), "other", false)).toBe(null);
    expect(pcEditAction(key("KeyV"), "other", true)).toBe(null);
    expect(pcEditAction(key("KeyA"), "other", true)).toBe(null);
  });

  it("ignores Command, Option, IME composition and other keys", () => {
    expect(pcEditAction(key("KeyC", { metaKey: true }), "field", true)).toBe(
      null,
    );
    expect(pcEditAction(key("KeyC", { altKey: true }), "field", true)).toBe(
      null,
    );
    expect(
      pcEditAction(key("KeyC", { isComposing: true }), "field", true),
    ).toBe(null);
    expect(pcEditAction(key("KeyC", { ctrlKey: false }), "field", true)).toBe(
      null,
    );
    expect(pcEditAction(key("KeyK"), "field", true)).toBe(null);
    expect(pcEditAction(key("KeyC", { shiftKey: true }), "field", true)).toBe(
      null,
    );
  });
});
