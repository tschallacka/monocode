import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
/** Answers what the fake Claude process is sent, after it is recorded. */
let reply: ((message: Record<string, unknown>) => void) | undefined;
const writeChild = vi.fn(async (_id: string, line: string) => {
  sent.push(line);
  const message = JSON.parse(line) as Record<string, unknown>;
  setTimeout(() => reply?.(message), 0);
});

vi.mock("../../core/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild,
}));

const {
  claudeMcpStatus,
  reconnectClaudeMcpServer,
  sendClaudeTurn,
  stopClaudeSession,
  __claudeTestReset,
} = await import("./claude");

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function emit(rec: Record<string, unknown>) {
  onLine!(JSON.stringify(rec));
}

function requestOf(message: Record<string, unknown>) {
  return message.request as Record<string, unknown> | undefined;
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

/** A live session whose Claude process has started and answered `initialize`. */
async function startSession() {
  void sendClaudeTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "open the shop",
    attachments: [],
    onEvent: () => undefined,
  });
  await waitFor(
    () => parse().some((m) => requestOf(m)?.subtype === "initialize"),
    "initialize",
  );
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: "monocode_1" },
  });
  await waitFor(() => parse().some((m) => m.type === "user"), "user prompt");
}

/** The fake process's `mcp_status` answer for a Chrome server in `status`. */
function statusReply(message: Record<string, unknown>, status: string) {
  emit({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: message.request_id,
      response: {
        mcpServers: [
          { name: "phpstorm", status: "connected", tools: [{}] },
          {
            name: "claude-in-chrome",
            status,
            tools: status === "connected" ? [{}, {}, {}] : [],
          },
        ],
      },
    },
  });
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  reply = undefined;
  writeChild.mockClear();
  __claudeTestReset();
});

afterEach(async () => {
  reply = undefined;
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("Claude in Chrome over the control protocol", () => {
  it("has no status to report before Claude runs for the session", async () => {
    expect(await claudeMcpStatus("s1")).toBeNull();
  });

  it("reads the session's MCP servers from its running process", async () => {
    await startSession();
    reply = (message) => {
      if (requestOf(message)?.subtype === "mcp_status") {
        statusReply(message, "failed");
      }
    };
    const servers = await claudeMcpStatus("s1");
    expect(servers).toEqual([
      { name: "phpstorm", status: "connected", tools: 1 },
      { name: "claude-in-chrome", status: "failed", tools: 0 },
    ]);
  });

  it("reconnects the extension by turning its server off and on again", async () => {
    await startSession();
    let enabled = true;
    reply = (message) => {
      const request = requestOf(message);
      // Claude answers status requests, never toggles.
      if (request?.subtype === "mcp_toggle") enabled = request.enabled === true;
      if (request?.subtype === "mcp_status") {
        statusReply(message, enabled ? "connected" : "disabled");
      }
    };
    const server = await reconnectClaudeMcpServer("s1", "claude-in-chrome");
    expect(server).toEqual({
      name: "claude-in-chrome",
      status: "connected",
      tools: 3,
    });
    const toggles = parse()
      .map(requestOf)
      .filter((request) => request?.subtype === "mcp_toggle");
    expect(toggles).toEqual([
      { subtype: "mcp_toggle", serverName: "claude-in-chrome", enabled: false },
      { subtype: "mcp_toggle", serverName: "claude-in-chrome", enabled: true },
    ]);
  });
});
