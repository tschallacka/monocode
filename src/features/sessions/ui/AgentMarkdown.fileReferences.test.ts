// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../model/fileRoots", () => ({
  resolveReference: async (reference: string) =>
    reference.startsWith("SubtotalAfterDiscountTest.php")
      ? {
          path: "/repo/wt/app/code/Test/SubtotalAfterDiscountTest.php",
          matches: 1,
        }
      : null,
}));

const { AgentMarkdown } = await import("./AgentMarkdown");
const { FileRootsContext, lazyFileRoots } = await import("./fileReferences");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(text: string, onOpenFile = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(
        FileRootsContext.Provider,
        { value: lazyFileRoots(async () => ["/repo/wt", "/repo"]) },
        createElement(AgentMarkdown, { text, cwd: "/repo", onOpenFile }),
      ),
    );
  });
  // Let the lookup settle and the chip re-render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return onOpenFile;
}

function chip(name: string) {
  return [...container.querySelectorAll("code")].find((code) =>
    code.textContent?.includes(name),
  )!;
}

describe("a file named in a reply", () => {
  it("links to where the file really is, like an IDE", async () => {
    const onOpenFile = await render(
      "Both added `SubtotalAfterDiscountTest.php`.",
    );
    const code = chip("SubtotalAfterDiscountTest.php");
    expect(code.getAttribute("role")).toBe("link");
    expect(code.getAttribute("title")).toBe(
      "/repo/wt/app/code/Test/SubtotalAfterDiscountTest.php",
    );
    act(() => code.click());
    expect(onOpenFile).toHaveBeenCalledWith(
      "/repo/wt/app/code/Test/SubtotalAfterDiscountTest.php",
      undefined,
    );
  });

  it("is plain code when the file is nowhere to be found", async () => {
    await render("Moved ours to `SubtotalAfterDiscountSegmentTest.php`.");
    const code = chip("SubtotalAfterDiscountSegmentTest.php");
    expect(code.getAttribute("role")).toBeNull();
  });
});
