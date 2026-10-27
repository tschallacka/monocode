import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(
  () => new Map<string, { name: string; path: string; relative: string }[]>(),
);
const onDisk = vi.hoisted(() => new Set<string>());
const worktrees = vi.hoisted(() => ({
  list: [] as { path: string; isMain: boolean; missing: boolean }[],
}));

vi.mock("../../files/model/fileIndex", () => ({
  loadProjectFiles: async (root: string) => files.get(root) ?? [],
}));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/Users/me",
  statFiles: async (paths: string[]) =>
    paths.map((path) => ({ path, mtimeMs: onDisk.has(path) ? 1 : null })),
}));
vi.mock("../../source-control/model/worktrees", () => ({
  listWorktrees: async () => ({ worktrees: worktrees.list, defaultRoot: "" }),
}));

const { mentionedWorktrees, resolveReference, sessionFileRoots } =
  await import("./fileRoots");

const MAIN = "/Users/me/www/shop";
const WT = "/Users/me/.config/tmp/asana-1/wt";

function file(root: string, relative: string) {
  const name = relative.split("/").pop()!;
  return { name, path: `${root}/${relative}`, relative };
}

beforeEach(() => {
  files.clear();
  onDisk.clear();
  worktrees.list = [];
});

describe("mentionedWorktrees", () => {
  it("orders the worktrees a session's commands worked in, newest first", () => {
    expect(
      mentionedWorktrees(
        [
          "cd /Users/me/a/wt && git status",
          "cd ~/.config/tmp/asana-1/wt && git log",
          "ls /Users/me/a/wt/app",
        ],
        ["/Users/me/a/wt", WT, "/Users/me/unused"],
        "/Users/me",
      ),
    ).toEqual(["/Users/me/a/wt", WT]);
  });
});

describe("sessionFileRoots", () => {
  it("puts a worktree the session worked in before the main repo", async () => {
    worktrees.list = [
      { path: MAIN, isMain: true, missing: false },
      { path: WT, isMain: false, missing: false },
    ];
    expect(await sessionFileRoots(MAIN, [`cd ${WT} && git diff`])).toEqual([
      MAIN,
      WT,
    ]);
    // A session working in the worktree itself still falls back to the repo.
    expect(await sessionFileRoots(WT, [])).toEqual([WT, MAIN]);
  });
});

describe("resolveReference", () => {
  const test = "app/code/Cart/Test/Unit/SubtotalAfterDiscountTest.php";

  it("finds a bare name in the worktree before the main repo", async () => {
    files.set(WT, [file(WT, test)]);
    files.set(MAIN, [file(MAIN, "other/SubtotalAfterDiscountTest.php")]);
    expect(
      await resolveReference("SubtotalAfterDiscountTest.php:12", [WT, MAIN]),
    ).toEqual({ path: `${WT}/${test}`, matches: 1 });
  });

  it("falls back to the main repo once the worktree is gone", async () => {
    files.set(MAIN, [file(MAIN, test), file(MAIN, `b/${test}`)]);
    expect(
      await resolveReference("SubtotalAfterDiscountTest.php", [WT, MAIN]),
    ).toEqual({ path: `${MAIN}/${test}`, matches: 2 });
  });

  it("tries a path with folders under each root in turn", async () => {
    onDisk.add(`${MAIN}/src/app.ts`);
    expect(await resolveReference("src/app.ts", [WT, MAIN])).toEqual({
      path: `${MAIN}/src/app.ts`,
      matches: 1,
    });
  });

  it("is not a link when no root has the file", async () => {
    expect(await resolveReference("Missing.php", [WT, MAIN])).toBeNull();
    expect(await resolveReference("src/missing.ts", [WT, MAIN])).toBeNull();
  });
});
