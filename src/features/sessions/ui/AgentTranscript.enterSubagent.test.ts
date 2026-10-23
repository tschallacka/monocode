import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { SubagentAccessContext, subagentRunLoader } from "./subagentAccess";

const blocks: Block[] = [
  { id: "user", role: "user", text: "Find the scope picker" },
  {
    id: "run",
    role: "tool",
    text: "Investigate the scope picker",
    tool: {
      callId: "toolu_run",
      kind: "agent",
      title: "Investigate the scope picker",
      status: "completed",
      detail: "The picker lives in ScopePicker.tsx.",
    },
    agentRun: {
      name: "code-researcher",
      agentType: "code-researcher",
      steps: [],
    },
  },
];

function render(enter?: (blockId: string) => void) {
  const transcript = createElement(AgentTranscript, { blocks, busy: false });
  return renderToStaticMarkup(
    enter
      ? createElement(
          SubagentAccessContext.Provider,
          { value: { enter } },
          transcript,
        )
      : transcript,
  );
}

describe("entering a subagent's run", () => {
  it("offers to open a finished run in the pane", () => {
    expect(render(() => undefined)).toMatch(
      /aria-label="Open [^"]+&#x27;s run"/,
    );
  });

  it("offers nothing where the pane cannot show a run", () => {
    expect(render()).not.toMatch(/aria-label="Open [^"]+&#x27;s run"/);
  });

  it("reads runs in full only for a local Claude session", () => {
    const claude = {
      harness: "claude" as const,
      providerSessionId: "1d9653bf-b45a-4fec-a7b5-54f7b46f0e80",
    };
    expect(subagentRunLoader(claude, true)).toBeTypeOf("function");
    expect(subagentRunLoader(claude, false)).toBeUndefined();
    expect(
      subagentRunLoader({ ...claude, providerSessionId: undefined }, true),
    ).toBeUndefined();
    expect(
      subagentRunLoader({ ...claude, harness: "codex" }, true),
    ).toBeUndefined();
  });
});
