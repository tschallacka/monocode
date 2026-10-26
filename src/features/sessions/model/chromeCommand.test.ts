import { describe, expect, it } from "vitest";
import { mcpServersFromStatus } from "../../../integrations/harness/providers/claude/claudeProtocol";
import { chromeLinkSummary, isChromeCommand } from "./chromeCommand";

describe("/chrome", () => {
  it("is the bare command only", () => {
    expect(isChromeCommand("/chrome")).toBe(true);
    expect(isChromeCommand("  /Chrome  ")).toBe(true);
    expect(isChromeCommand("/chrome open the shop")).toBe(false);
    expect(isChromeCommand("use /chrome")).toBe(false);
  });

  it("says whether the session can drive the browser", () => {
    const server = (status: string, tools = 0, error?: string) => ({
      kind: "ready" as const,
      server: {
        name: "claude-in-chrome",
        status,
        tools,
        ...(error ? { error } : {}),
      },
    });
    expect(chromeLinkSummary(server("connected", 22))).toEqual({
      text: "Connected, 22 browser tools available.",
      ok: true,
    });
    expect(chromeLinkSummary(server("failed", 0, "socket closed"))).toEqual({
      text: "Not connected: socket closed.",
      ok: false,
    });
    expect(chromeLinkSummary(server("disabled")).text).toBe("Disconnected.");
    expect(chromeLinkSummary({ kind: "ready", server: null }).text).toContain(
      "not enabled",
    );
    expect(chromeLinkSummary({ kind: "idle" }).ok).toBe(false);
  });
});

describe("mcpServersFromStatus", () => {
  it("reads each server's status and tool count", () => {
    expect(
      mcpServersFromStatus({
        subtype: "success",
        response: {
          mcpServers: [
            { name: "claude-in-chrome", status: "connected", tools: [{}, {}] },
            { name: "broken", status: "failed", error: "spawn ENOENT" },
            { status: "connected" },
          ],
        },
      }),
    ).toEqual([
      { name: "claude-in-chrome", status: "connected", tools: 2 },
      { name: "broken", status: "failed", tools: 0, error: "spawn ENOENT" },
    ]);
  });

  it("passes on a refusal as an error", () => {
    expect(() =>
      mcpServersFromStatus({ subtype: "error", error: "Unknown subtype" }),
    ).toThrow("Unknown subtype");
  });
});
