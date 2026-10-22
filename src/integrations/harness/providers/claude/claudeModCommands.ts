import { homeDir } from "../../../../platform/tauri/fs";
import type { ModCommand } from "../../../../features/mods/model/modHost";
import {
  killChild,
  resolveClaudeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import {
  buildClaudeSpawnArgs,
  buildControlRequest,
  modCommandsFromInitialize,
  parseControlResponse,
  parseJsonLine,
} from "./claudeProtocol";

const PROBE_ID = "monocode-claude-mod-commands";
const INIT_REQUEST_ID = "monocode_mod_commands_init";
const DISCOVERY_TIMEOUT_MS = 20_000;

/**
 * Lists the user's mod commands with no session running: a Claude process
 * spawned as a session is, so mods load, that answers `initialize` and is
 * stopped. It sends no prompt and keeps no session on disk.
 */
export async function discoverClaudeModCommands(): Promise<ModCommand[]> {
  const { path } = await resolveClaudeBinary();
  const cwd = await homeDir();
  const probeId = `${PROBE_ID}-${crypto.randomUUID()}`;

  let listed: ((commands: ModCommand[]) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  const pending = new Promise<ModCommand[]>((resolve, reject) => {
    listed = resolve;
    failed = reject;
  });

  watchChild(
    probeId,
    (line) => {
      const rec = parseJsonLine(line);
      const response = rec ? parseControlResponse(rec) : null;
      if (response?.requestId !== INIT_REQUEST_ID) return;
      if (response.ok) listed?.(modCommandsFromInitialize(response.payload));
      else failed?.(new Error(response.error ?? "initialize failed"));
    },
    () => failed?.(new Error("Claude Code exited before listing commands")),
  );

  const timer = setTimeout(
    () => failed?.(new Error("Listing Claude mod commands timed out")),
    DISCOVERY_TIMEOUT_MS,
  );
  try {
    await spawnChild(
      probeId,
      path,
      [
        ...buildClaudeSpawnArgs({ includePartialMessages: false }),
        "--no-session-persistence",
      ],
      cwd,
      undefined,
      "claude",
    );
    await writeChild(
      probeId,
      JSON.stringify(
        buildControlRequest(INIT_REQUEST_ID, { subtype: "initialize" }),
      ),
    );
    return await pending;
  } finally {
    clearTimeout(timer);
    unwatchChild(probeId);
    await killChild(probeId).catch(() => undefined);
  }
}
