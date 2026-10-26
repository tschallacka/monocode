import { expect, it } from "vitest";
import type { ClaudeCodeSession } from "../../../platform/tauri/claudeCodeSessions";
import { claudeCodeSessionsIn } from "./ClaudeCodeSessionPicker";

const session = (id: string, cwd: string): ClaudeCodeSession => ({
  id,
  cwd,
  title: id,
  gitBranch: null,
  startedAt: null,
  lastAt: null,
  modifiedMs: 0,
});

it("lists the sessions run in a project folder or below it", () => {
  const sessions = [
    session("root", "/home/me/app"),
    session("nested", "/home/me/app/packages/web"),
    session("sibling", "/home/me/app-old"),
    session("other", "/home/me/elsewhere"),
  ];
  expect(
    claudeCodeSessionsIn(sessions, "/home/me/app/").map((found) => found.id),
  ).toEqual(["root", "nested"]);
});
