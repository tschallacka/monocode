import { createContext, useContext, useEffect, useState } from "react";
import { resolveReference, type ResolvedReference } from "../model/fileRoots";

/**
 * Where the file references in a transcript resolve, most specific first,
 * worked out the first time a reference asks: a transcript that names no file
 * never lists its repo's worktrees. A reply rendered outside a transcript has
 * none and keeps its plain paths.
 */
export type FileRoots = {
  get: () => Promise<readonly string[]>;
  /** Files the session read, edited or wrote, most recent first. */
  touched?: () => readonly string[];
};

export const FileRootsContext = createContext<FileRoots | null>(null);

/** Roots computed by `load` once, on first use. */
export function lazyFileRoots(
  load: () => Promise<readonly string[]>,
  touched?: () => readonly string[],
): FileRoots {
  let roots: Promise<readonly string[]> | undefined;
  return {
    get: () => (roots ??= load()),
    ...(touched ? { touched } : {}),
  };
}

export type ReferenceLookup =
  | { status: "pending" }
  | { status: "found"; file: ResolvedReference }
  | { status: "missing" };

const lookups = new WeakMap<
  FileRoots,
  Map<string, Promise<ResolvedReference | null>>
>();

function lookup(
  roots: FileRoots,
  reference: string,
): Promise<ResolvedReference | null> {
  let byReference = lookups.get(roots);
  if (!byReference) {
    byReference = new Map();
    lookups.set(roots, byReference);
  }
  let found = byReference.get(reference);
  if (!found) {
    found = roots
      .get()
      .then((list) =>
        resolveReference(reference, list, roots.touched?.() ?? []),
      )
      .catch(() => null);
    byReference.set(reference, found);
  }
  return found;
}

/**
 * The file a relative reference in a reply resolves to, the way an IDE links
 * it: found under one of the transcript's roots, or missing. While a lookup
 * runs again for new roots the previous answer stands, so links do not flicker
 * as the session moves on. Undefined outside a transcript.
 */
export function useResolvedReference(
  reference: string | undefined,
): ReferenceLookup | undefined {
  const roots = useContext(FileRootsContext);
  const [state, setState] = useState<{
    reference: string;
    value: ReferenceLookup;
  }>();
  useEffect(() => {
    if (!roots || !reference) return;
    let cancelled = false;
    void lookup(roots, reference).then((file) => {
      if (cancelled) return;
      setState({
        reference,
        value: file ? { status: "found", file } : { status: "missing" },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [roots, reference]);
  if (!roots || !reference) return undefined;
  return state?.reference === reference ? state.value : { status: "pending" };
}
