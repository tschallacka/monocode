import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

const text =
  "I rendered the invoice: `/Users/me/tmp/fixed-invoice.png`. See `Total.php`.";

function render(localMedia: boolean) {
  return renderToStaticMarkup(
    createElement(AgentMarkdown, { text, cwd: "/repo", localMedia }),
  );
}

describe("an image named in inline code", () => {
  it("shows the image under its path where the reply names it", () => {
    const markup = render(true);
    expect(markup).toContain("fixed-invoice.png");
    expect(markup).toContain(
      'data-local-media="/Users/me/tmp/fixed-invoice.png"',
    );
    // A file that is not media stays a plain path chip.
    expect(markup.match(/data-local-media=/g)).toHaveLength(1);
  });

  it("stays a path chip where the chat does not show media inline", () => {
    expect(render(false)).not.toContain("data-local-media");
  });
});
