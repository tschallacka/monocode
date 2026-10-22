import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  closeModPane,
  dismissModToast,
  inputModElement,
  modHostSnapshot,
  pressModElement,
  renderModComponent,
  selectModElement,
  showModPane,
  subscribeModHost,
  type ModHostSnapshot,
  type ModNode,
} from "../model/modHost";
import { ModTree, type ModTreeActions } from "./ModTree";

/** A monospace cell at the pane's 13px text, for the columns a mod lays out to. */
const CELL_PX = 7.8;
const MIN_COLUMNS = 20;

export function useModHost(sessionId: string | undefined): ModHostSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessionId ? subscribeModHost(sessionId, listener) : () => {},
    [sessionId],
  );
  return useSyncExternalStore(subscribe, () =>
    sessionId ? modHostSnapshot(sessionId) : modHostSnapshot(""),
  );
}

function useColumns() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(80);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(
        MIN_COLUMNS,
        Math.floor(entry.contentRect.width / CELL_PX),
      );
      setColumns((current) => (current === next ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, columns };
}

type SiteState = { tree: ModNode | null; error: string | null };

/** One engine-drawn instance: asks `ui_render` again whenever it may be stale. */
function ModSite({
  sessionId,
  component,
  instanceId,
  onEmpty,
}: {
  sessionId: string;
  component: "Pane" | "AbovePrompt";
  instanceId: string;
  onEmpty?: (empty: boolean) => void;
}) {
  const { renderVersion, connected } = useModHost(sessionId);
  const { ref, columns } = useColumns();
  const [localVersion, setLocalVersion] = useState(0);
  const [state, setState] = useState<SiteState>({ tree: null, error: null });
  const sequence = useRef(0);

  useEffect(() => {
    if (!connected) return;
    const asked = ++sequence.current;
    renderModComponent(
      sessionId,
      component,
      instanceId,
      { bodyColumns: columns },
      { columns, rows: 40, isFullscreen: true },
    )
      .then(({ tree, hooked }) => {
        if (asked !== sequence.current) return;
        setState({ tree: hooked ? tree : null, error: null });
      })
      .catch((error: unknown) => {
        if (asked !== sequence.current) return;
        setState({ tree: null, error: String(error) });
      });
  }, [
    sessionId,
    component,
    instanceId,
    columns,
    renderVersion,
    localVersion,
    connected,
  ]);

  useEffect(() => onEmpty?.(!state.tree), [state.tree, onEmpty]);

  const actions = useMemo<ModTreeActions>(() => {
    const redraw = () => setLocalVersion((version) => version + 1);
    const fail = (error: unknown) =>
      setState((current) => ({ ...current, error: String(error) }));
    return {
      press: (press, key) =>
        void pressModElement(sessionId, press, key).then(redraw, fail),
      input: (press, kind, value) =>
        void inputModElement(sessionId, press, kind, value).then(
          kind === "submit" ? redraw : undefined,
          fail,
        ),
      select: (press, value) =>
        void selectModElement(sessionId, press, value).then(redraw, fail),
    };
  }, [sessionId]);

  return (
    <div ref={ref} className="min-w-0">
      {state.tree ? <ModTree node={state.tree} actions={actions} /> : null}
      {state.error && component === "Pane" ? (
        <p className="mt-2 text-[12px] text-red-400/90">{state.error}</p>
      ) : null}
    </div>
  );
}

/** The session's mod panes, one sub-tab each, in a MonoCode editor tab. */
export function ModsSurface({ sessionId }: { sessionId: string }) {
  const host = useModHost(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  const shown =
    host.panes.find((pane) => pane.id === selected)?.id ??
    host.panes.find((pane) => pane.id === host.shownPaneId)?.id ??
    host.panes[0]?.id ??
    null;

  if (!host.connected && host.panes.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-[13px] text-content/60">
        Mods appear here once this session's Claude process is running.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {host.panes.length > 0 ? (
        <div
          role="tablist"
          aria-label="Mod panes"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-stroke px-2 py-1"
        >
          {host.panes.map((pane) => (
            <div
              key={pane.id}
              className={`flex items-center rounded-md text-[12px] ${
                pane.id === shown
                  ? "bg-selection text-content"
                  : "text-content/60 hover:bg-selection-hover"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={pane.id === shown}
                title={pane.plugin}
                onClick={() => {
                  setSelected(pane.id);
                  void showModPane(sessionId, pane.id).catch(console.error);
                }}
                className="px-2 py-0.5"
              >
                {pane.title}
              </button>
              <button
                type="button"
                aria-label={`Close ${pane.title}`}
                onClick={() =>
                  void closeModPane(sessionId, pane.id).catch(console.error)
                }
                className="pr-1.5 text-content/40 hover:text-content"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {shown ? (
          <ModSite
            key={shown}
            sessionId={sessionId}
            component="Pane"
            instanceId={shown}
          />
        ) : (
          <ModOverview host={host} />
        )}
      </div>
    </div>
  );
}

function ModOverview({ host }: { host: ModHostSnapshot }) {
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <p className="text-content/60">
        No mod has a pane open in this session. Mods that only add hooks, tools
        or commands still run here.
      </p>
      {host.statuses.length > 0 ? (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-content/40">
            Status
          </h3>
          {host.statuses.map((status) => (
            <p key={status.plugin}>
              <span className="text-content/50">{status.plugin}</span>{" "}
              {status.text}
            </p>
          ))}
        </section>
      ) : null}
      {host.logs.length > 0 ? (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-content/40">
            Log
          </h3>
          {host.logs.slice(-50).map((log) => (
            <p key={log.id} className="whitespace-pre-wrap text-content/70">
              <span className="text-content/45">{log.plugin}</span> {log.text}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** The band a mod draws above the composer; nothing while no mod draws there. */
export function ModAbovePrompt({ sessionId }: { sessionId: string }) {
  const { connected } = useModHost(sessionId);
  const [empty, setEmpty] = useState(true);
  if (!connected) return null;
  return (
    <div
      className={
        empty
          ? "hidden"
          : "mb-2 rounded-lg border border-stroke bg-background-base/80 px-3 py-2"
      }
    >
      <ModSite
        sessionId={sessionId}
        component="AbovePrompt"
        instanceId="above-prompt"
        onEmpty={setEmpty}
      />
    </div>
  );
}

/** Mod status lines, as chips; pressing one opens the session's Mods tab. */
export function ModStatusChips({
  sessionId,
  onOpenMods,
}: {
  sessionId: string | undefined;
  onOpenMods: () => void;
}) {
  const host = useModHost(sessionId);
  if (!sessionId || (host.statuses.length === 0 && host.panes.length === 0)) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onOpenMods}
      title={host.statuses
        .map((status) => `${status.plugin}: ${status.text}`)
        .join("\n")}
      className="flex min-w-0 items-center gap-2 rounded px-1.5 text-content/60 hover:bg-selection-hover hover:text-content"
    >
      <span className="shrink-0">Mods</span>
      {host.statuses.slice(0, 3).map((status) => (
        <span key={status.plugin} className="max-w-48 truncate text-content/45">
          {status.text}
        </span>
      ))}
    </button>
  );
}

/** Mod toasts, newest last; each leaves after the time its mod asked for. */
export function ModToasts({ sessionId }: { sessionId: string | undefined }) {
  const host = useModHost(sessionId);
  useEffect(() => {
    if (!sessionId) return;
    const timers = host.toasts.map((toast) =>
      setTimeout(() => dismissModToast(sessionId, toast.id), toast.timeoutMs),
    );
    return () => timers.forEach(clearTimeout);
  }, [sessionId, host.toasts]);
  if (!sessionId || host.toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2">
      {host.toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto rounded-lg border border-stroke bg-background-base px-3 py-2 text-[12px] text-content shadow-lg"
        >
          <span className="mr-1 text-content/45">{toast.plugin}</span>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
