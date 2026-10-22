/**
 * MonoCode as a surface for Claude Code mods. Claude Code serves mod UI to
 * hosts that are not a terminal through its `ui_*` control protocol, the one
 * Claude Code Desktop speaks: the session pushes `system/ui_*` records (pane
 * roster, status lines, toasts, redraws) and answers `ui_render`, `ui_press`
 * and friends as control requests. One host per MonoCode session; the
 * provider connects a transport while its process runs.
 */

/** The protocol is the engine's internal one; MonoCode draws as Desktop does. */
export const MOD_SURFACE = "desktop";
export const MOD_CLIENT_ID = "monocode";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOASTS = 5;
const MAX_LOGS = 200;

export type ModPane = { id: string; title: string; plugin: string };

export type ModToast = {
  id: string;
  plugin: string;
  text: string;
  timeoutMs: number;
};

export type ModLog = { id: string; plugin: string; text: string };

/** A slash command a mod registered (`$.command.register`). */
export type ModCommand = {
  name: string;
  description: string;
  argumentHint: string;
  plugin: string;
};

export type ModPress = { plugin: string; handle: number };

export type ModNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: ModChild[];
  press?: ModPress;
};

export type ModChild = ModNode | string | number | null;

export type ModViewport = {
  columns: number;
  rows: number;
  isFullscreen?: boolean;
};

export type ModRender = { tree: ModNode | null; hooked: boolean };

export type ModHostSnapshot = {
  connected: boolean;
  panes: ModPane[];
  shownPaneId: string | null;
  focusRequestedPaneId: string | null;
  statuses: Array<{ plugin: string; text: string }>;
  toasts: ModToast[];
  logs: ModLog[];
  commands: ModCommand[];
  /** Moves on every redraw request; mounted instances draw again. */
  renderVersion: number;
};

export type ModTransport = {
  nextRequestId: () => string;
  write: (requestId: string, request: Record<string, unknown>) => Promise<void>;
};

type Pending = {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Host = {
  snapshot: ModHostSnapshot;
  transport: ModTransport | null;
  pending: Map<string, Pending>;
  listeners: Set<() => void>;
  nextLocalId: number;
  /** The roster read at attach is in: later pushes show panes on request. */
  rosterSeen: boolean;
};

const EMPTY: ModHostSnapshot = {
  connected: false,
  panes: [],
  shownPaneId: null,
  focusRequestedPaneId: null,
  statuses: [],
  toasts: [],
  logs: [],
  commands: [],
  renderVersion: 0,
};

const hosts = new Map<string, Host>();
const paneOpenedListeners = new Set<
  (sessionId: string, paneId: string) => void
>();

/**
 * A mod showed a pane after the session attached: a board tool Claude called,
 * a command the user ran, a mod's own `$.ui.open`. Panes a mod opens as the
 * session starts are already in the roster and never announced.
 */
export function subscribeModPaneOpened(
  listener: (sessionId: string, paneId: string) => void,
): () => void {
  paneOpenedListeners.add(listener);
  return () => paneOpenedListeners.delete(listener);
}

function hostFor(sessionId: string): Host {
  let host = hosts.get(sessionId);
  if (!host) {
    host = {
      snapshot: EMPTY,
      transport: null,
      pending: new Map(),
      listeners: new Set(),
      nextLocalId: 0,
      rosterSeen: false,
    };
    hosts.set(sessionId, host);
  }
  return host;
}

function update(host: Host, patch: Partial<ModHostSnapshot>) {
  host.snapshot = { ...host.snapshot, ...patch };
  for (const listener of host.listeners) listener();
}

function localId(host: Host): string {
  host.nextLocalId += 1;
  return String(host.nextLocalId);
}

export function modHostSnapshot(sessionId: string): ModHostSnapshot {
  return hosts.get(sessionId)?.snapshot ?? EMPTY;
}

export function subscribeModHost(
  sessionId: string,
  listener: () => void,
): () => void {
  const host = hostFor(sessionId);
  host.listeners.add(listener);
  return () => host.listeners.delete(listener);
}

/** The provider's process is up: attach as a surface and start serving. */
export async function connectModHost(
  sessionId: string,
  transport: ModTransport,
  viewport: ModViewport,
): Promise<void> {
  const host = hostFor(sessionId);
  host.transport = transport;
  update(host, { connected: true });
  await request(sessionId, {
    subtype: "ui_attach",
    surface: MOD_SURFACE,
    client_id: MOD_CLIENT_ID,
    viewport,
  });
  const roster = await request(sessionId, {
    subtype: "ui_panes",
    client_id: MOD_CLIENT_ID,
  });
  applyPanes(sessionId, host, roster);
  host.rosterSeen = true;
}

/** The commands the session's mods registered, as `initialize` listed them. */
export function setModCommands(sessionId: string, commands: ModCommand[]) {
  update(hostFor(sessionId), { commands });
}

/** The mod command a prompt runs (`/boards`, `/todo-board x`), if any. */
export function modCommandInPrompt(
  text: string,
  sessionId: string | undefined,
): ModCommand | null {
  if (!sessionId) return null;
  const name = /^\s*\/([^\s/\\]+)(?=\s|$)/.exec(text)?.[1];
  if (!name) return null;
  return (
    modHostSnapshot(sessionId).commands.find(
      (command) => command.name === name,
    ) ?? null
  );
}

/** The process ended: its mods, panes and pending asks go with it. */
export function disconnectModHost(sessionId: string) {
  const host = hosts.get(sessionId);
  if (!host) return;
  host.transport = null;
  host.rosterSeen = false;
  for (const [, pending] of host.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error("The Claude session ended"));
  }
  host.pending.clear();
  update(host, { ...EMPTY, logs: host.snapshot.logs });
}

/** A `control_response` for one of the host's asks; false when it is not one. */
export function settleModResponse(
  sessionId: string,
  requestId: string,
  outcome:
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; error: string },
): boolean {
  const host = hosts.get(sessionId);
  const pending = host?.pending.get(requestId);
  if (!host || !pending) return false;
  host.pending.delete(requestId);
  clearTimeout(pending.timer);
  if (outcome.ok) pending.resolve(outcome.payload);
  else pending.reject(new Error(outcome.error));
  return true;
}

/** A `system/ui_*` push from the session; false when the record is not one. */
export function noteModPush(
  sessionId: string,
  record: Record<string, unknown>,
): boolean {
  const subtype = typeof record.subtype === "string" ? record.subtype : "";
  if (!subtype.startsWith("ui_")) return false;
  const host = hostFor(sessionId);
  const plugin = typeof record.plugin === "string" ? record.plugin : "";
  const text = typeof record.text === "string" ? record.text : "";
  switch (subtype) {
    case "ui_panes":
      applyPanes(sessionId, host, record);
      break;
    case "ui_status": {
      const statuses = host.snapshot.statuses.filter(
        (entry) => entry.plugin !== plugin,
      );
      if (text) statuses.push({ plugin, text });
      update(host, { statuses });
      break;
    }
    case "ui_toast": {
      const timeoutMs =
        typeof record.timeout_ms === "number" ? record.timeout_ms : 4000;
      const toasts = [
        ...host.snapshot.toasts,
        { id: localId(host), plugin, text, timeoutMs },
      ].slice(-MAX_TOASTS);
      update(host, { toasts });
      break;
    }
    case "ui_log": {
      const logs = [
        ...host.snapshot.logs,
        { id: localId(host), plugin, text },
      ].slice(-MAX_LOGS);
      update(host, { logs });
      break;
    }
    case "ui_invalidate":
      update(host, { renderVersion: host.snapshot.renderVersion + 1 });
      break;
    default:
      break;
  }
  return true;
}

export function dismissModToast(sessionId: string, toastId: string) {
  const host = hosts.get(sessionId);
  if (!host) return;
  update(host, {
    toasts: host.snapshot.toasts.filter((toast) => toast.id !== toastId),
  });
}

function applyPanes(
  sessionId: string,
  host: Host,
  record: Record<string, unknown>,
) {
  const previous = host.snapshot;
  const panes = Array.isArray(record.panes)
    ? record.panes.flatMap((raw): ModPane[] => {
        const pane = raw as Record<string, unknown>;
        return typeof pane.id === "string"
          ? [
              {
                id: pane.id,
                title: typeof pane.title === "string" ? pane.title : pane.id,
                plugin: typeof pane.plugin === "string" ? pane.plugin : "",
              },
            ]
          : [];
      })
    : [];
  const pick = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  const shownPaneId = pick("shown_id");
  update(host, {
    panes,
    shownPaneId,
    focusRequestedPaneId: pick("focus_requested_id"),
  });
  const newlyShown =
    shownPaneId &&
    (shownPaneId !== previous.shownPaneId ||
      !previous.panes.some((pane) => pane.id === shownPaneId));
  if (host.rosterSeen && newlyShown) {
    for (const listener of paneOpenedListeners)
      listener(sessionId, shownPaneId);
  }
}

function request(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const host = hosts.get(sessionId);
  const transport = host?.transport;
  if (!host || !transport) {
    return Promise.reject(new Error("No Claude session is running"));
  }
  const requestId = transport.nextRequestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      host.pending.delete(requestId);
      reject(new Error(`${String(body.subtype)} timed out`));
    }, REQUEST_TIMEOUT_MS);
    host.pending.set(requestId, { resolve, reject, timer });
    transport.write(requestId, body).catch((error: unknown) => {
      host.pending.delete(requestId);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** Draws one instance of a mod site (`Pane`, `AbovePrompt`) for this surface. */
export async function renderModComponent(
  sessionId: string,
  component: string,
  instanceId: string,
  props: Record<string, unknown>,
  viewport: ModViewport,
): Promise<ModRender> {
  const payload = await request(sessionId, {
    subtype: "ui_render",
    surface: MOD_SURFACE,
    client_id: MOD_CLIENT_ID,
    component,
    instance_id: instanceId,
    props,
    viewport,
  });
  const tree = payload.tree;
  return {
    tree: tree && typeof tree === "object" ? (tree as ModNode) : null,
    hooked: payload.hooked === true,
  };
}

export async function pressModElement(
  sessionId: string,
  press: ModPress,
  key?: string,
  href?: string,
): Promise<void> {
  await request(sessionId, {
    subtype: "ui_press",
    surface: MOD_SURFACE,
    client_id: MOD_CLIENT_ID,
    plugin: press.plugin,
    handle: press.handle,
    ...(key ? { key } : {}),
    ...(href ? { href } : {}),
  });
}

export async function inputModElement(
  sessionId: string,
  press: ModPress,
  kind: "change" | "submit",
  value: string,
): Promise<void> {
  await request(sessionId, {
    subtype: "ui_input",
    plugin: press.plugin,
    handle: press.handle,
    kind,
    value,
  });
}

export async function selectModElement(
  sessionId: string,
  press: ModPress,
  value: string,
): Promise<void> {
  await request(sessionId, {
    subtype: "ui_select",
    plugin: press.plugin,
    handle: press.handle,
    value,
  });
}

export async function showModPane(sessionId: string, paneId: string) {
  await request(sessionId, {
    subtype: "ui_pane_show",
    id: paneId,
    surface: MOD_SURFACE,
  });
}

export async function closeModPane(sessionId: string, paneId: string) {
  await request(sessionId, {
    subtype: "ui_close",
    id: paneId,
    client_id: MOD_CLIENT_ID,
  });
}
