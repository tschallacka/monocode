/** Variables added to a session's agent process, as `NAME=value cmd` would. */
export type SessionEnv = Record<string, string>;

export type SessionEnvRow = { name: string; value: string };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function isEnvName(name: string): boolean {
  return ENV_NAME.test(name);
}

/** Keeps only valid names with string values; anything else is dropped. */
export function sessionEnv(value: unknown): SessionEnv {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const env: SessionEnv = {};
  for (const [name, entry] of Object.entries(value)) {
    if (isEnvName(name) && typeof entry === "string") env[name] = entry;
  }
  return env;
}

export function sameSessionEnv(a?: SessionEnv, b?: SessionEnv): boolean {
  const left = Object.entries(a ?? {});
  if (left.length !== Object.keys(b ?? {}).length) return false;
  return left.every(([name, value]) => b?.[name] === value);
}

/** POSIX single quoting, only where the value would otherwise split or expand. */
export function shellQuote(value: string): string {
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The variables as a shell would read them in front of a command. */
export function sessionEnvPrefix(env: SessionEnv): string {
  return Object.entries(env)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
}

export type SessionEnvRowsResult =
  { env: SessionEnv; error?: undefined } | { env?: undefined; error: string };

/** Blank rows are ignored; a bad or repeated name is reported, not dropped. */
export function sessionEnvFromRows(
  rows: readonly SessionEnvRow[],
): SessionEnvRowsResult {
  const env: SessionEnv = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !row.value) continue;
    if (!isEnvName(name))
      return {
        error: name
          ? `${name} is not a valid variable name. Use letters, digits and _, not starting with a digit.`
          : "Every value needs a variable name.",
      };
    if (name in env) return { error: `${name} is listed twice.` };
    env[name] = row.value;
  }
  return { env };
}

export function sessionEnvRows(env: SessionEnv | undefined): SessionEnvRow[] {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }));
}

/**
 * Reads pasted assignments the way a shell would: `export`, quoting and
 * backslash escapes are honoured, and a command after the assignments (as in
 * `A=1 B='x y' claude`) ends them. Null when the text holds no assignment.
 */
export function parseEnvAssignments(text: string): SessionEnvRow[] | null {
  const rows: SessionEnvRow[] = [];
  for (const line of shellLines(text)) {
    const words = line[0] === "export" ? line.slice(1) : line;
    for (const word of words) {
      const split = word.indexOf("=");
      const name = split > 0 ? word.slice(0, split) : "";
      if (!isEnvName(name)) break;
      rows.push({ name, value: word.slice(split + 1) });
    }
  }
  return rows.length ? rows : null;
}

/** Words per line; a newline inside quotes stays part of its word. */
function shellLines(text: string): string[][] {
  const lines: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endLine = () => {
    endWord();
    if (words.length) lines.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\n" || char === ";") endLine();
    else if (char === " " || char === "\t" || char === "\r") endWord();
    else if (char === "#" && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== "\n") i += 1;
    } else if (char === "'") {
      inWord = true;
      const close = text.indexOf("'", i + 1);
      const end = close < 0 ? text.length : close;
      word += text.slice(i + 1, end);
      i = end;
    } else if (char === '"') {
      inWord = true;
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) {
        if (text[i] === "\\" && '"\\$`'.includes(text[i + 1] ?? "")) i += 1;
        else if (text[i] === "\\" && text[i + 1] === "\n") {
          i += 1;
          continue;
        }
        word += text[i];
      }
    } else if (char === "\\") {
      if (text[i + 1] === "\n") {
        i += 1;
        continue;
      }
      inWord = true;
      if (i + 1 < text.length) word += text[++i];
    } else {
      inWord = true;
      word += char;
    }
  }
  endLine();
  return lines;
}
