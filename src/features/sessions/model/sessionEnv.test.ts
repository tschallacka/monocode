import { describe, expect, it } from "vitest";
import {
  parseEnvAssignments,
  sameSessionEnv,
  sessionEnv,
  sessionEnvFromRows,
  sessionEnvPrefix,
  shellQuote,
} from "./sessionEnv";

describe("shellQuote", () => {
  it("leaves plain words alone and single-quotes the rest", () => {
    expect(shellQuote("eu-west-1")).toBe("eu-west-1");
    expect(shellQuote("https://x.test/a?b=1")).toBe("'https://x.test/a?b=1'");
    expect(shellQuote("two words")).toBe("'two words'");
    expect(shellQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`);
    expect(shellQuote("")).toBe("''");
  });

  it("builds the prefix a shell would read in front of the command", () => {
    expect(sessionEnvPrefix({ A: "1", B: "x y" })).toBe("A=1 B='x y'");
  });
});

describe("parseEnvAssignments", () => {
  it("reads quoting, escapes, export and comments as a shell does", () => {
    expect(
      parseEnvAssignments(
        [
          "# credentials",
          "export TOKEN='a b$c'",
          'NAME="say \\"hi\\" $x"',
          "PLAIN=one\\ two",
          "EMPTY=",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "TOKEN", value: "a b$c" },
      { name: "NAME", value: 'say "hi" $x' },
      { name: "PLAIN", value: "one two" },
      { name: "EMPTY", value: "" },
    ]);
  });

  it("stops at the command after a prefix", () => {
    expect(parseEnvAssignments("A=1 B='x y' claude --resume A=2")).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "x y" },
    ]);
  });

  it("keeps a quoted newline and ignores text that assigns nothing", () => {
    expect(parseEnvAssignments("KEY='line 1\nline 2'")).toEqual([
      { name: "KEY", value: "line 1\nline 2" },
    ]);
    expect(parseEnvAssignments("just a value = here")).toBeNull();
    expect(parseEnvAssignments("1BAD=x")).toBeNull();
  });
});

describe("sessionEnvFromRows", () => {
  it("skips blank rows and reports bad or repeated names", () => {
    expect(
      sessionEnvFromRows([
        { name: " A ", value: "1" },
        { name: "", value: "" },
      ]),
    ).toEqual({ env: { A: "1" } });
    expect(sessionEnvFromRows([{ name: "", value: "x" }]).error).toMatch(
      /needs a variable name/,
    );
    expect(sessionEnvFromRows([{ name: "A-B", value: "x" }]).error).toMatch(
      /not a valid variable name/,
    );
    expect(
      sessionEnvFromRows([
        { name: "A", value: "1" },
        { name: "A", value: "2" },
      ]).error,
    ).toMatch(/listed twice/);
  });
});

describe("sessionEnv", () => {
  it("drops invalid names and non-string values", () => {
    expect(sessionEnv({ OK: "1", "BAD NAME": "x", NUM: 2 })).toEqual({
      OK: "1",
    });
    expect(sessionEnv(null)).toEqual({});
    expect(sessionEnv(["A"])).toEqual({});
  });

  it("compares by content, not order", () => {
    expect(sameSessionEnv({ A: "1", B: "2" }, { B: "2", A: "1" })).toBe(true);
    expect(sameSessionEnv({ A: "1" }, { A: "2" })).toBe(false);
    expect(sameSessionEnv(undefined, {})).toBe(true);
  });
});
