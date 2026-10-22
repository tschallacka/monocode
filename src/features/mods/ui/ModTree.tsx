import { openUrl } from "@tauri-apps/plugin-opener";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import type { ModChild, ModNode, ModPress } from "../model/modHost";

/** What a drawn element reports back to the session that drew it. */
export type ModTreeActions = {
  press: (press: ModPress, key?: string) => void;
  input: (press: ModPress, kind: "change" | "submit", value: string) => void;
  select: (press: ModPress, value: string) => void;
};

/** Mod sizes are terminal cells: columns are `ch`, rows a line of text. */
const ROW = 1.4;
const STEPS: Record<string, number> = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 };

/** The theme keys a mod may paint with, in MonoCode's palette. */
const THEME_COLORS: Record<string, string> = {
  text: "var(--color-content)",
  inverseText: "var(--color-background-base)",
  inactive: "color-mix(in srgb, var(--color-content) 45%, transparent)",
  subtle: "color-mix(in srgb, var(--color-content) 55%, transparent)",
  suggestion: "var(--color-accent)",
  remember: "var(--color-accent)",
  success: "#3fb950",
  error: "#f85149",
  warning: "#d29922",
  merged: "#a371f7",
  claude: "#d97757",
  permission: "var(--color-accent)",
  planMode: "#2dd4bf",
  autoAccept: "#a371f7",
  promptBorder: "var(--color-stroke)",
  bashBorder: "#f472b6",
  ide: "var(--color-accent)",
  diffAdded: "var(--color-diff-add, #3fb950)",
  diffRemoved: "var(--color-diff-del, #f85149)",
  diffAddedDimmed: "color-mix(in srgb, #3fb950 50%, transparent)",
  diffRemovedDimmed: "color-mix(in srgb, #f85149 50%, transparent)",
  diffAddedWord: "#3fb950",
  diffRemovedWord: "#f85149",
};

function color(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return THEME_COLORS[value] ?? value;
}

function columns(value: unknown): string | undefined {
  if (typeof value === "number") return `${value}ch`;
  if (typeof value === "string")
    return STEPS[value] ? `${STEPS[value]}px` : value;
  return undefined;
}

function rows(value: unknown): string | undefined {
  if (typeof value === "number") return `${value * ROW}em`;
  if (typeof value === "string")
    return STEPS[value] ? `${STEPS[value]}px` : value;
  return undefined;
}

function boxStyle(props: Record<string, unknown>): CSSProperties {
  const p = props;
  const style: CSSProperties = {
    display: p.display === "none" ? "none" : "flex",
    flexDirection: (p.flexDirection as CSSProperties["flexDirection"]) ?? "row",
    flexGrow: p.flexGrow as number | undefined,
    flexShrink: (p.flexShrink as number | undefined) ?? 1,
    flexWrap: p.flexWrap as CSSProperties["flexWrap"],
    alignItems: p.alignItems as CSSProperties["alignItems"],
    alignSelf: p.alignSelf as CSSProperties["alignSelf"],
    justifyContent: p.justifyContent as CSSProperties["justifyContent"],
    columnGap: columns(p.columnGap ?? p.gap),
    rowGap: rows(p.rowGap ?? p.gap),
    width: columns(p.width),
    height: rows(p.height),
    minWidth: columns(p.minWidth) ?? 0,
    minHeight: rows(p.minHeight),
    marginTop: rows(p.marginTop ?? p.marginY ?? p.margin),
    marginBottom: rows(p.marginBottom ?? p.marginY ?? p.margin),
    marginLeft: columns(p.marginLeft ?? p.marginX ?? p.margin),
    marginRight: columns(p.marginRight ?? p.marginX ?? p.margin),
    paddingTop: rows(p.paddingTop ?? p.paddingY ?? p.padding),
    paddingBottom: rows(p.paddingBottom ?? p.paddingY ?? p.padding),
    paddingLeft: columns(p.paddingLeft ?? p.paddingX ?? p.padding),
    paddingRight: columns(p.paddingRight ?? p.paddingX ?? p.padding),
    backgroundColor: color(p.backgroundColor),
    overflow: p.overflow === "hidden" ? "hidden" : undefined,
  };
  if (typeof p.borderStyle === "string" && p.borderStyle !== "none") {
    const border = color(p.borderColor) ?? "var(--color-stroke)";
    style.border = `${p.borderStyle === "double" ? "3px double" : "1px solid"} ${border}`;
    style.borderRadius = p.borderStyle === "round" ? 8 : 4;
    if (p.borderDimColor) style.opacity = 0.7;
  }
  if (p.position === "absolute") {
    style.position = "absolute";
    style.top = rows(p.top);
    style.left = columns(p.left);
    style.right = columns(p.right);
    style.bottom = rows(p.bottom);
  } else if (p.position === "relative") {
    style.position = "relative";
  }
  return style;
}

const TEXT_SIZES: Record<string, string> = {
  caption: "11px",
  footnote: "12px",
  body: "13px",
  heading: "15px",
  title: "18px",
};
const WEIGHTS: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

function textStyle(props: Record<string, unknown>): CSSProperties {
  const p = props;
  const truncate = typeof p.wrap === "string" && p.wrap !== "wrap";
  const decorations = [
    p.underline ? "underline" : "",
    p.strikethrough ? "line-through" : "",
  ].filter(Boolean);
  const fg = color(p.color);
  const bg = color(p.backgroundColor);
  return {
    color: p.inverse ? (bg ?? "var(--color-background-base)") : fg,
    backgroundColor: p.inverse ? (fg ?? "var(--color-content)") : bg,
    opacity: p.dimColor ? 0.55 : undefined,
    fontSize: typeof p.size === "string" ? TEXT_SIZES[p.size] : undefined,
    fontWeight:
      typeof p.weight === "string"
        ? WEIGHTS[p.weight]
        : p.bold
          ? WEIGHTS.semibold
          : undefined,
    fontStyle: p.italic ? "italic" : undefined,
    fontFamily: p.mono ? "var(--font-mono)" : undefined,
    fontVariantNumeric: p.tabular ? "tabular-nums" : undefined,
    textDecoration: decorations.length ? decorations.join(" ") : undefined,
    direction: p.dir === "rtl" ? "rtl" : undefined,
    whiteSpace: truncate ? "nowrap" : "pre-wrap",
    overflow: truncate ? "hidden" : undefined,
    textOverflow: truncate ? "ellipsis" : undefined,
    minWidth: 0,
  };
}

function isNode(child: ModChild): child is ModNode {
  return !!child && typeof child === "object";
}

function openLink(href: string) {
  if (!/^https?:\/\//i.test(href)) return;
  void openUrl(href).catch(console.error);
}

function ModInput({
  node,
  actions,
}: {
  node: ModNode;
  actions: ModTreeActions;
}) {
  const props = node.props ?? {};
  const drawn = typeof props.value === "string" ? props.value : "";
  const [value, setValue] = useState(drawn);
  useEffect(() => setValue(drawn), [drawn]);
  const lines =
    typeof props.rows === "number" && props.rows > 1 ? props.rows : 1;
  const send = (kind: "change" | "submit", text: string) => {
    if (node.press) actions.input(node.press, kind, text);
  };
  const shared = {
    value,
    placeholder:
      typeof props.placeholder === "string" ? props.placeholder : undefined,
    autoFocus: props.autoFocus === true,
    "aria-label": typeof props.label === "string" ? props.label : "Mod input",
    className:
      "min-w-0 flex-1 rounded-md border border-content/15 bg-transparent px-2 py-1 text-[13px] text-content outline-none focus:border-accent/60",
    onChange: (event: { currentTarget: { value: string } }) => {
      setValue(event.currentTarget.value);
      send("change", event.currentTarget.value);
    },
    onKeyDown: (event: {
      key: string;
      shiftKey: boolean;
      preventDefault: () => void;
    }) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      send("submit", value);
    },
  };
  return (
    <label className="flex min-w-0 items-center gap-2">
      {typeof props.label === "string" ? (
        <span className="shrink-0 text-content/60">{props.label}</span>
      ) : null}
      {lines > 1 ? (
        <textarea rows={lines} {...shared} />
      ) : (
        <input {...shared} />
      )}
    </label>
  );
}

function ModSelect({
  node,
  actions,
}: {
  node: ModNode;
  actions: ModTreeActions;
}) {
  const props = node.props ?? {};
  const options = Array.isArray(props.options)
    ? (props.options as Array<{ value: string; label?: string }>)
    : [];
  const drawn =
    typeof props.value === "string" ? props.value : options[0]?.value;
  const [value, setValue] = useState(drawn);
  useEffect(() => setValue(drawn), [drawn]);
  return (
    <label className="flex min-w-0 items-center gap-2">
      {typeof props.label === "string" ? (
        <span className="shrink-0 text-content/60">{props.label}</span>
      ) : null}
      <select
        value={value}
        aria-label={
          typeof props.label === "string" ? props.label : "Mod choice"
        }
        autoFocus={props.autoFocus === true}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          if (node.press) actions.select(node.press, next);
        }}
        className="rounded-md border border-content/15 bg-background-base px-2 py-1 text-[13px] text-content outline-none focus:border-accent/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label ?? option.value}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModCode({ props }: { props: Record<string, unknown> }) {
  const source = typeof props.source === "string" ? props.source : "";
  const diff = props.format === "diff";
  const start = typeof props.startLine === "number" ? props.startLine : null;
  const lines = source.split("\n");
  return (
    <pre
      className="min-w-0 overflow-x-auto rounded-md bg-content/5 px-3 py-2 font-mono text-[12px] leading-5"
      style={{ whiteSpace: props.wrap === "truncate-end" ? "pre" : "pre-wrap" }}
    >
      {lines.map((line, index) => {
        const tone = !diff
          ? undefined
          : line.startsWith("+")
            ? THEME_COLORS.diffAdded
            : line.startsWith("-")
              ? THEME_COLORS.diffRemoved
              : line.startsWith("@@")
                ? THEME_COLORS.subtle
                : undefined;
        return (
          <div key={index} style={{ color: tone }}>
            {start != null && !diff ? (
              <span
                className="mr-3 inline-block select-none text-right text-content/35"
                style={{ width: "4ch" }}
              >
                {start + index}
              </span>
            ) : null}
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function renderChildren(
  children: ModChild[] | undefined,
  actions: ModTreeActions,
): ReactNode[] {
  return (children ?? []).map((child, index) =>
    isNode(child) ? (
      <ModElement key={index} node={child} actions={actions} />
    ) : child == null ? null : (
      String(child)
    ),
  );
}

function ModElement({
  node,
  actions,
}: {
  node: ModNode;
  actions: ModTreeActions;
}): ReactNode {
  const props = node.props ?? {};
  switch (node.type) {
    case "Box":
      return (
        <div style={boxStyle(props)}>
          {renderChildren(node.children, actions)}
        </div>
      );
    case "Text":
      return (
        <span style={textStyle(props)}>
          {renderChildren(node.children, actions)}
        </span>
      );
    case "Button": {
      const label =
        typeof props.label === "string" && !node.children?.length
          ? props.label
          : null;
      const key = typeof props.key === "string" ? props.key : undefined;
      const primary = props.variant === "primary" && props.plain !== true;
      return (
        <button
          type="button"
          aria-label={typeof props.label === "string" ? props.label : undefined}
          onClick={() => node.press && actions.press(node.press, key)}
          className={
            props.plain === true
              ? "rounded px-1 text-left text-content hover:bg-content/10"
              : primary
                ? "rounded-md bg-accent px-2.5 py-0.5 text-[12px] font-medium text-white hover:bg-accent/90"
                : "rounded-md border border-content/15 px-2.5 py-0.5 text-[12px] text-content hover:bg-content/10"
          }
          style={{ opacity: props.dimColor ? 0.6 : undefined }}
        >
          {label ?? renderChildren(node.children, actions)}
        </button>
      );
    }
    case "Input":
      return <ModInput node={node} actions={actions} />;
    case "Select":
      return <ModSelect node={node} actions={actions} />;
    case "Link": {
      const href = typeof props.href === "string" ? props.href : "";
      const text = node.children?.length
        ? renderChildren(node.children, actions)
        : typeof props.label === "string"
          ? props.label
          : href;
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            openLink(href);
          }}
          className="text-sky-400/90 hover:text-sky-300 hover:underline"
        >
          {text}
        </a>
      );
    }
    case "Code":
      return <ModCode props={props} />;
    case "Markdown":
      return (
        <div
          style={{ opacity: props.dimColor ? 0.6 : undefined }}
          className="min-w-0"
        >
          <AgentMarkdown
            text={typeof props.text === "string" ? props.text : ""}
          />
        </div>
      );
    case "Svg": {
      const source = typeof props.source === "string" ? props.source : "";
      // An image, never inline markup: the drawing cannot reach the page.
      return (
        <img
          alt={typeof props.alt === "string" ? props.alt : ""}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`}
          width={typeof props.width === "number" ? props.width : undefined}
          height={typeof props.height === "number" ? props.height : undefined}
          className="max-w-full"
        />
      );
    }
    case "Client":
      return (
        <div className="rounded-md border border-dashed border-content/20 px-2 py-1 text-[12px] text-content/50">
          This part of the mod runs its own surface module, which MonoCode does
          not load yet.
        </div>
      );
    default:
      return <>{renderChildren(node.children, actions)}</>;
  }
}

/** One mod-drawn tree, as the session's `ui_render` returned it. */
export function ModTree({
  node,
  actions,
}: {
  node: ModNode;
  actions: ModTreeActions;
}) {
  return (
    <div className="min-w-0 text-[13px] leading-[1.4] text-content">
      <ModElement node={node} actions={actions} />
    </div>
  );
}
