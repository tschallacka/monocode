import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";

const prefs = vi.hoisted(() => ({ foldWork: true }));
vi.mock("../../settings/model/displayPrefs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../settings/model/displayPrefs")
  >()),
  useFoldWork: () => prefs.foldWork,
}));

const { AgentTranscript } = await import("./AgentTranscript");

const blocks: Block[] = [
  {
    id: "user",
    role: "user",
    text: "Clean up",
    startedAt: 1_000,
    durationMs: 12_000,
  },
  {
    id: "rm",
    role: "tool",
    text: "rm -f build.log && git status --short",
    tool: { kind: "shell", status: "completed", detail: "M src/app.ts" },
  },
  { id: "answer", role: "assistant", text: "Cleaned up." },
];

function render() {
  return renderToStaticMarkup(
    createElement(AgentTranscript, { blocks, busy: false }),
  );
}

afterEach(() => {
  prefs.foldWork = true;
});

describe("Fold finished work setting", () => {
  it("folds a turn's work once the agent answered, by default", () => {
    const markup = render();
    expect(markup).toContain("Cleaned up.");
    expect(markup).not.toContain("git status --short");
  });

  it("keeps the work open and each finished step openable when off", () => {
    prefs.foldWork = false;
    const markup = render();
    expect(markup).toContain("Cleaned up.");
    expect(markup).toContain("git status --short");
    expect(markup).toContain(
      'aria-label="Show output of rm -f build.log &amp;&amp; git status --short"',
    );
  });

  it("opens every step, finished or running, whatever the setting", () => {
    const lone = (tool: Block) =>
      renderToStaticMarkup(
        createElement(AgentTranscript, {
          blocks: [{ id: "user", role: "user", text: "Check the rates" }, tool],
          busy: false,
        }),
      );
    expect(
      lone({
        id: "pull",
        role: "tool",
        text: "cd ~/www/dugros && git pull --ff-only",
        tool: {
          kind: "shell",
          status: "completed",
          detail: "Already up to date.",
        },
      }),
    ).toContain(
      'aria-label="Show output of cd ~/www/dugros &amp;&amp; git pull --ff-only"',
    );
    expect(
      lone({
        id: "query",
        role: "tool",
        text: 'n98-magerun2 db:query "SELECT 1"',
        tool: { kind: "shell", status: "in_progress" },
      }),
    ).toContain(
      'aria-label="Show output of n98-magerun2 db:query &quot;SELECT 1&quot;"',
    );
  });
});
