import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectModHost,
  disconnectModHost,
  modHostSnapshot,
  noteModPush,
  pressModElement,
  renderModComponent,
  settleModResponse,
  subscribeModHost,
  type ModTransport,
} from "./modHost";

const viewport = { columns: 80, rows: 40, isFullscreen: true };
let session = 0;

/** A transport that records each ask and lets the test answer it. */
function fakeTransport(sessionId: string) {
  let id = 0;
  const sent: Array<{ requestId: string; request: Record<string, unknown> }> =
    [];
  const transport: ModTransport = {
    nextRequestId: () => `req_${++id}`,
    write: async (requestId, request) => {
      sent.push({ requestId, request });
    },
  };
  const answer = (index: number, payload: Record<string, unknown>) =>
    settleModResponse(sessionId, sent[index].requestId, { ok: true, payload });
  return { transport, sent, answer };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function newSessionId() {
  session += 1;
  return `session-${session}`;
}

afterEach(() => vi.useRealTimers());

describe("mod host pushes", () => {
  it("keeps the pane roster, one status per plugin, toasts and logs", () => {
    const id = newSessionId();
    const listener = vi.fn();
    subscribeModHost(id, listener);

    noteModPush(id, {
      subtype: "ui_panes",
      panes: [{ id: "todo", title: "Todo", plugin: "todo-board" }],
      shown_id: "todo",
      focus_requested_id: null,
    });
    noteModPush(id, { subtype: "ui_status", plugin: "probe", text: "one" });
    noteModPush(id, { subtype: "ui_status", plugin: "probe", text: "two" });
    noteModPush(id, {
      subtype: "ui_toast",
      plugin: "probe",
      text: "hi",
      timeout_ms: 1500,
    });
    noteModPush(id, { subtype: "ui_log", plugin: "probe", text: "logged" });

    const snapshot = modHostSnapshot(id);
    expect(snapshot.panes).toEqual([
      { id: "todo", title: "Todo", plugin: "todo-board" },
    ]);
    expect(snapshot.shownPaneId).toBe("todo");
    expect(snapshot.statuses).toEqual([{ plugin: "probe", text: "two" }]);
    expect(snapshot.toasts).toMatchObject([
      { plugin: "probe", text: "hi", timeoutMs: 1500 },
    ]);
    expect(snapshot.logs).toMatchObject([{ plugin: "probe", text: "logged" }]);
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("clears a plugin's status when it sends none", () => {
    const id = newSessionId();
    noteModPush(id, { subtype: "ui_status", plugin: "probe", text: "on" });
    noteModPush(id, { subtype: "ui_status", plugin: "probe", text: null });
    expect(modHostSnapshot(id).statuses).toEqual([]);
  });

  it("moves the render version on every invalidate", () => {
    const id = newSessionId();
    noteModPush(id, { subtype: "ui_invalidate", event: "ui.render" });
    noteModPush(id, { subtype: "ui_invalidate", event: "ui.render" });
    expect(modHostSnapshot(id).renderVersion).toBe(2);
  });

  it("leaves records that are not ui_ pushes to the caller", () => {
    expect(noteModPush(newSessionId(), { subtype: "status" })).toBe(false);
  });
});

describe("mod host requests", () => {
  it("attaches as a desktop surface, then reads the pane roster", async () => {
    const id = newSessionId();
    const { transport, sent, answer } = fakeTransport(id);

    const connected = connectModHost(id, transport, viewport);
    await flush();
    expect(sent[0].request).toEqual({
      subtype: "ui_attach",
      surface: "desktop",
      client_id: "monocode",
      viewport,
    });
    answer(0, { surfaces: ["desktop"] });
    await flush();
    expect(sent[1].request).toEqual({
      subtype: "ui_panes",
      client_id: "monocode",
    });
    answer(1, { panes: [{ id: "p", title: "P", plugin: "m" }], shown_id: "p" });
    await connected;

    expect(modHostSnapshot(id)).toMatchObject({
      connected: true,
      panes: [{ id: "p", title: "P", plugin: "m" }],
      shownPaneId: "p",
    });
  });

  it("draws a component and presses what it drew", async () => {
    const id = newSessionId();
    const { transport, sent, answer } = fakeTransport(id);
    const connected = connectModHost(id, transport, viewport);
    await flush();
    answer(0, {});
    await flush();
    answer(1, { panes: [] });
    await connected;

    const tree = {
      type: "Button",
      props: { key: "inc", label: "Increment" },
      press: { plugin: "probe", handle: 7 },
    };
    const drawn = renderModComponent(
      id,
      "Pane",
      "p",
      { bodyColumns: 60 },
      viewport,
    );
    await flush();
    expect(sent[2].request).toMatchObject({
      subtype: "ui_render",
      component: "Pane",
      instance_id: "p",
      props: { bodyColumns: 60 },
    });
    answer(2, { tree, hooked: true });
    await expect(drawn).resolves.toEqual({ tree, hooked: true });

    const pressed = pressModElement(id, tree.press, "inc");
    await flush();
    expect(sent[3].request).toMatchObject({
      subtype: "ui_press",
      plugin: "probe",
      handle: 7,
      key: "inc",
    });
    answer(3, { handled: true });
    await pressed;
  });

  it("rejects an ask the engine refused", async () => {
    const id = newSessionId();
    const { transport, sent } = fakeTransport(id);
    const connected = connectModHost(id, transport, viewport);
    await flush();
    settleModResponse(id, sent[0].requestId, { ok: false, error: "no ui" });
    await expect(connected).rejects.toThrow("no ui");
  });

  it("fails pending asks and forgets the roster when the session ends", async () => {
    const id = newSessionId();
    const { transport, answer } = fakeTransport(id);
    const connected = connectModHost(id, transport, viewport);
    await flush();
    answer(0, {});
    await flush();
    answer(1, { panes: [{ id: "p", title: "P", plugin: "m" }] });
    await connected;

    const drawn = renderModComponent(id, "Pane", "p", {}, viewport);
    await flush();
    disconnectModHost(id);
    await expect(drawn).rejects.toThrow("ended");
    expect(modHostSnapshot(id)).toMatchObject({ connected: false, panes: [] });
    await expect(
      renderModComponent(id, "Pane", "p", {}, viewport),
    ).rejects.toThrow("No Claude session");
  });

  it("times out an ask nobody answers", async () => {
    vi.useFakeTimers();
    const id = newSessionId();
    const { transport } = fakeTransport(id);
    const connected = connectModHost(id, transport, viewport);
    const settled = expect(connected).rejects.toThrow("ui_attach timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});
