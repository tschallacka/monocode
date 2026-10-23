// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import {
  backgroundSubagents,
  RunningSubagents,
  runningSubagents,
  subagentBackgroundTasks,
} from "./RunningSubagents";

let container: HTMLDivElement;
let root: Root;

function run(id: string, title: string, patch: Partial<Block> = {}): Block {
  return {
    id,
    role: "tool",
    text: title,
    streaming: true,
    startedAt: 0,
    tool: { callId: id, title, kind: "agent", status: "in_progress" },
    ...patch,
  };
}

function render(props: Partial<ComponentProps<typeof RunningSubagents>>) {
  act(() =>
    root.render(
      createElement(RunningSubagents, {
        runs: [],
        liveIds: new Set((props.runs ?? []).map((block) => block.id)),
        viewedId: null,
        onView: () => {},
        ...props,
      }),
    ),
  );
}

function rows() {
  return [...container.querySelectorAll<HTMLElement>("[aria-pressed]")];
}

const ids = (blocks: Block[]) => blocks.map((block) => block.id);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(125_000);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runningSubagents", () => {
  it("lists only runs that have not reported back", () => {
    expect(
      ids(
        runningSubagents([
          run("a", "Correctness review"),
          run("b", "Finished review", {
            streaming: false,
            tool: { callId: "b", kind: "agent", status: "completed" },
          }),
          { id: "c", role: "tool", text: "Read", tool: { kind: "read" } },
          run("d", "Style review"),
        ]),
      ),
    ).toEqual(["a", "d"]);
  });

  it("ignores runs left in progress by an earlier turn", () => {
    expect(
      ids(
        runningSubagents([
          { id: "u1", role: "user", text: "first" },
          run("old", "Stale review"),
          { id: "u2", role: "user", text: "second" },
          run("new", "Live review"),
        ]),
      ),
    ).toEqual(["new"]);
  });

  it("keeps runs from the turn a steered message cut in on", () => {
    expect(
      ids(
        runningSubagents([
          { id: "u1", role: "user", text: "first" },
          run("old", "Stale review"),
          { id: "u2", role: "user", text: "second" },
          run("live", "Backend agent"),
          { id: "u3", role: "user", text: "and more", steered: true },
          run("new", "Frontend agent"),
        ]),
      ),
    ).toEqual(["live", "new"]);
  });

  it("hides duplicate rows from older Claude task snapshots", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: "Run four agents" },
      ...["Mail", "Customers", "SSO", "Key"].flatMap((name, index) => [
        run(`real_${index}`, name),
        run(`duplicate_${index}`, name, {
          tool: {
            callId: `agent:${name}`,
            kind: "agent",
            status: "in_progress",
          },
        }),
      ]),
    ];
    expect(ids(runningSubagents(blocks))).toEqual([
      "real_0",
      "real_1",
      "real_2",
      "real_3",
    ]);
  });
});

describe("RunningSubagents", () => {
  it("lists Main above a line per run with its elapsed time", () => {
    render({
      runs: [
        run("a", "Correctness review"),
        run("d", "Style review", { startedAt: 65_000 }),
      ],
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      "Main2 subagents running",
      "Correctness review2m 5s",
      "Style review1m",
    ]);
    expect(rows()[0].getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(1000));
    expect(rows()[2].textContent).toBe("Style review1m 1s");
  });

  it("swaps to a run and back to Main", () => {
    const onView = vi.fn();
    render({ runs: [run("a", "Review")], onView });
    act(() => rows()[1].click());
    expect(onView).toHaveBeenLastCalledWith("a");

    render({ runs: [run("a", "Review")], viewedId: "a", onView });
    expect(rows()[0].getAttribute("aria-pressed")).toBe("false");
    expect(rows()[1].getAttribute("aria-pressed")).toBe("true");
    act(() => rows()[0].click());
    expect(onView).toHaveBeenLastCalledWith(null);
  });

  it("marks a viewed run that has finished or was stopped", () => {
    render({
      runs: [
        run("a", "Review", {
          streaming: false,
          tool: { callId: "a", kind: "agent", status: "completed" },
        }),
        run("b", "Stopped review"),
      ],
      liveIds: new Set(),
      viewedId: "a",
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      "Main",
      "Reviewdone",
      "Stopped reviewstopped",
    ]);
  });

  it("stops a run that has a background task", () => {
    const onStop = vi.fn();
    render({
      runs: [run("a", "Review"), run("b", "Other")],
      stoppable: new Set(["a"]),
      onStop,
    });
    const stops = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label^="Stop "]',
    );
    expect(stops).toHaveLength(1);
    act(() => stops[0].click());
    expect(onStop).toHaveBeenCalledWith("a");
    expect(stops[0].textContent).toBe("Stopping…");
  });
});

describe("subagentBackgroundTasks", () => {
  it("pairs each run with the task its tool call spawned", () => {
    const runs = [run("a", "Add Duration kind"), run("b", "Same name")];
    const tasks = [
      { id: "t2", description: "Same name", agent: true, callId: "b" },
      { id: "t1", description: "Renamed later", agent: true, callId: "a" },
    ];
    expect([...subagentBackgroundTasks(tasks, runs)]).toEqual([
      ["b", "t2"],
      ["a", "t1"],
    ]);
  });

  it("falls back to a description that still carries the Task prefix", () => {
    const runs = [run("a", "panel Done button setting")];
    const tasks = [
      { id: "t1", description: "Task panel Done button setting", agent: true },
    ];
    expect(subagentBackgroundTasks(tasks, runs).get("a")).toBe("t1");
  });

  it("pairs a described task with the live run over a finished one", () => {
    const done = run("a", "Same brief", {
      streaming: false,
      tool: {
        callId: "a",
        title: "Same brief",
        kind: "agent",
        status: "completed",
      },
    });
    const runs = [done, run("b", "Same brief")];
    const tasks = [{ id: "t1", description: "Same brief", agent: true }];
    expect([...subagentBackgroundTasks(tasks, runs)]).toEqual([["b", "t1"]]);
  });

  it("leaves shell tasks alone", () => {
    const runs = [run("a", "npm run dev")];
    const tasks = [{ id: "t1", description: "npm run dev" }];
    expect(subagentBackgroundTasks(tasks, runs).size).toBe(0);
  });
});

describe("backgroundSubagents", () => {
  it("keeps a background run live while its task runs, call returned or not", () => {
    const launched = run("a", "Copy the test database", {
      tool: {
        callId: "toolu_a",
        title: "Copy the test database",
        kind: "agent",
        status: "completed",
      },
    });
    const finished = run("b", "Earlier run", {
      tool: {
        callId: "toolu_b",
        title: "Earlier run",
        kind: "agent",
        status: "completed",
      },
    });
    const shell = run("c", "npm run dev", {
      tool: { callId: "toolu_c", title: "npm run dev", kind: "shell" },
    });
    const blocks = [launched, finished, shell];
    expect(
      ids(
        backgroundSubagents(blocks, [
          { id: "t1", description: "Copy", agent: true, callId: "toolu_a" },
          { id: "t2", description: "npm run dev", callId: "toolu_c" },
        ]),
      ),
    ).toEqual(["a"]);
    expect(backgroundSubagents(blocks, [])).toEqual([]);
  });
});

describe("RunningSubagents tree", () => {
  const a = run("a", "Audit the module");
  const b = run("run:b", "Check the templates");
  const c = run("run:c", "Read one template");
  const childrenOf = (block: Block) =>
    block.id === "a" ? [b] : block.id === "run:b" ? [c] : [];
  const liveIds = new Set(["a", "run:b", "run:c"]);
  const listed = () =>
    rows()
      .map((row) => row.closest<HTMLElement>("[data-running-subagent]"))
      .map((line) => [
        line?.dataset.runningSubagent ?? "main",
        line?.dataset.depth ?? "0",
      ]);

  it("folds a run's working subagents into a count until it is opened", () => {
    render({ runs: [a], liveIds, childrenOf });
    expect(listed()).toEqual([
      ["main", "0"],
      ["a", "0"],
    ]);
    expect(rows()[1].getAttribute("aria-label")).toContain(
      "1 subagent running",
    );
    expect(rows()[1].textContent).toContain("+1");
  });

  it("unfolds the opened run to show what it spawned", () => {
    render({ runs: [a], liveIds, childrenOf, viewedId: "a" });
    expect(listed()).toEqual([
      ["main", "0"],
      ["a", "0"],
      ["run:b", "1"],
    ]);
  });

  it("keeps the whole branch open down to a nested run being viewed", () => {
    const onView = vi.fn();
    render({ runs: [a], liveIds, childrenOf, viewedId: "run:c", onView });
    expect(listed()).toEqual([
      ["main", "0"],
      ["a", "0"],
      ["run:b", "1"],
      ["run:c", "2"],
    ]);
    act(() => rows()[2].click());
    expect(onView).toHaveBeenCalledWith("run:b");
  });
});
