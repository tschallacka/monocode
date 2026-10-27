import { loadProjectFiles } from "../../files/model/fileIndex";
import { homeDir, statFiles } from "../../../platform/tauri/fs";
import { joinPath, pathKey } from "../../../shared/lib/paths";
import { listWorktrees } from "../../source-control/model/worktrees";

/**
 * Worktrees a session's commands mention, the most recently mentioned first.
 * An agent that made a worktree of its own (`cd …/wt && git …`) talks about
 * the files in it, so a file it names belongs there before anywhere else.
 */
export function mentionedWorktrees(
  texts: readonly string[],
  worktrees: readonly string[],
  home?: string,
): string[] {
  const spellings = (path: string) =>
    home && path.startsWith(`${home}/`)
      ? [path, `~${path.slice(home.length)}`]
      : [path];
  const lastMention = new Map<string, number>();
  texts.forEach((text, index) => {
    for (const tree of worktrees) {
      if (spellings(tree).some((spelling) => text.includes(spelling))) {
        lastMention.set(tree, index);
      }
    }
  });
  return [...lastMention.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tree]) => tree);
}

/**
 * Where a session's file references resolve, most specific first: the folder
 * it works in, the worktrees of its repo it worked in, then the repo itself.
 * A worktree that is gone drops out, so its files fall back to the main repo.
 */
type ListedWorktree = { path: string; isMain: boolean; missing: boolean };

/** How long a repo's worktree list is reused while a session keeps working. */
const WORKTREE_LIST_MS = 15_000;
const worktreeLists = new Map<
  string,
  { at: number; list: Promise<ListedWorktree[]> }
>();

function repoWorktrees(cwd: string): Promise<ListedWorktree[]> {
  const cached = worktreeLists.get(cwd);
  if (cached && Date.now() - cached.at < WORKTREE_LIST_MS) return cached.list;
  const list = listWorktrees(cwd).then((result) => result.worktrees);
  worktreeLists.set(cwd, { at: Date.now(), list });
  list.catch(() => worktreeLists.delete(cwd));
  return list;
}

export async function sessionFileRoots(
  cwd: string,
  texts: readonly string[],
): Promise<string[]> {
  let worktrees: ListedWorktree[];
  try {
    worktrees = await repoWorktrees(cwd);
  } catch {
    return [cwd];
  }
  const live = worktrees.filter((tree) => !tree.missing);
  const main = live.find((tree) => tree.isMain)?.path;
  const home = await homeDir().catch(() => undefined);
  const mentioned = mentionedWorktrees(
    texts,
    live.filter((tree) => !tree.isMain).map((tree) => tree.path),
    home,
  );
  const seen = new Set<string>();
  return [cwd, ...mentioned, ...(main ? [main] : [])].filter((root) => {
    const key = pathKey(root);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A reference found on disk, and how many files carry its name. */
export type ResolvedReference = { path: string; matches: number };

/** `Total.php:12` and `Total.php#L12` name the same file as `Total.php`. */
function withoutLocation(reference: string): string {
  return reference.trim().replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
}

/**
 * The file a relative reference in a reply means, the way an IDE resolves
 * it: a path is tried under each root in turn, and a bare name is looked up
 * in each root's files, the first root that has it winning. Null when no root
 * has it, so the reference is not offered as a link.
 */
export async function resolveReference(
  reference: string,
  roots: readonly string[],
): Promise<ResolvedReference | null> {
  const clean = withoutLocation(reference);
  if (!clean) return null;
  if (clean.includes("/")) {
    const candidates = roots.map((root) => joinPath(root, clean));
    const stats = await statFiles(candidates);
    const found = stats.find((stat) => stat.mtimeMs != null);
    return found ? { path: found.path, matches: 1 } : null;
  }
  for (const root of roots) {
    const files = await loadProjectFiles(root).catch(() => []);
    const matches = files.filter((file) => file.name === clean);
    if (matches.length === 0) continue;
    const nearest = [...matches].sort(
      (a, b) => a.relative.length - b.relative.length,
    )[0];
    return { path: nearest.path, matches: matches.length };
  }
  return null;
}
