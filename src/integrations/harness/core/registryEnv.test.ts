import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}));

import { spawnChild } from "./child";
import { registerHarness, sendHarnessTurn, type HarnessAdapter } from "./registry";
import type { SendTurnInput } from "./types";

describe("session environment in turns", () => {
  it("restarts a child started with other variables, and only then", async () => {
    mocks.invoke.mockResolvedValue(42);
    const stopSession = vi.fn(async (_sessionId: string) => undefined);
    const adapter: HarnessAdapter = {
      id: "cursor",
      live: true,
      // Like a provider: the first turn spawns, later turns reuse the child.
      async sendTurn(input: SendTurnInput) {
        if (!spawned.has(input.sessionId)) {
          spawned.add(input.sessionId);
          await spawnChild(input.sessionId, "agent", [], input.cwd);
        }
      },
      async steerTurn() {},
      async cancelTurn() {},
      respondApproval() {},
      stopSession: async (sessionId) => {
        spawned.delete(sessionId);
        await stopSession(sessionId);
      },
      async forgetSession() {},
      bindSession() {},
    };
    const spawned = new Set<string>();
    registerHarness(adapter);
    const turn = (env?: Record<string, string>) =>
      sendHarnessTurn({
        harness: "cursor",
        sessionId: "s1",
        cwd: "/tmp",
        model: "cursor:composer-2.5",
        text: "hi",
        runtimeMode: "supervised",
        ...(env ? { env } : {}),
        onEvent: () => undefined,
      });

    await turn({ TOKEN: "a" });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "harness_spawn",
      expect.objectContaining({ env: { TOKEN: "a" } }),
    );
    await turn({ TOKEN: "a" });
    await turn();
    expect(stopSession).not.toHaveBeenCalled();

    await turn({ TOKEN: "b" });
    expect(stopSession).toHaveBeenCalledWith("s1");
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "harness_spawn",
      expect.objectContaining({ env: { TOKEN: "b" } }),
    );
  });
});
