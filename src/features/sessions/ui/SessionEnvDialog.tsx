import { useState, type ClipboardEvent, type FormEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Eye, Plus, Trash2 } from "../../../shared/ui/icons";
import {
  parseEnvAssignments,
  sessionEnvFromRows,
  sessionEnvPrefix,
  sessionEnvRows,
  type SessionEnv,
  type SessionEnvRow,
} from "../model/sessionEnv";

const EMPTY_ROW: SessionEnvRow = { name: "", value: "" };

const FIELD =
  "h-8 min-w-0 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] text-content outline-none placeholder:text-content/30 focus:border-content/30";

export function SessionEnvDialog({
  initial,
  sessionTitle,
  command,
  running,
  onSave,
  onClose,
}: {
  initial?: SessionEnv;
  sessionTitle: string;
  /** The agent's command, shown after the variables in the preview. */
  command: string;
  /** Saving restarts the agent; say so before it happens. */
  running: boolean;
  onSave: (env: SessionEnv) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SessionEnvRow[]>(() => {
    const stored = sessionEnvRows(initial);
    return stored.length ? stored : [EMPTY_ROW];
  });
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const result = sessionEnvFromRows(rows);
  const prefix = result.env ? sessionEnvPrefix(result.env) : "";

  const update = (index: number, patch: Partial<SessionEnvRow>) => {
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
    if (error) setError("");
  };

  const remove = (index: number) => {
    setRows((current) => {
      const next = current.filter((_, at) => at !== index);
      return next.length ? next : [EMPTY_ROW];
    });
    if (error) setError("");
  };

  // `A=1 B='two words'` or a pasted .env block fills in rows of its own.
  const paste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes("=")) return;
    const parsed = parseEnvAssignments(text);
    if (!parsed) return;
    event.preventDefault();
    const pasted = new Set(parsed.map((entry) => entry.name));
    const kept = (row: SessionEnvRow) => !pasted.has(row.name.trim());
    setRows((current) => [
      ...current.slice(0, index).filter(kept),
      ...parsed,
      ...current.slice(index + 1).filter(kept),
    ]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (result.error !== undefined) {
      setError(result.error);
      return;
    }
    onSave(result.env);
  };

  return (
    <Modal
      title="Environment variables"
      description={sessionTitle}
      size="md"
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 text-[12px]">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-x-2 gap-y-1.5">
          <span className="font-medium text-content/60">Name</span>
          <span className="flex items-center justify-between font-medium text-content/60">
            Value
            <button
              type="button"
              aria-pressed={revealed}
              aria-label={revealed ? "Hide values" : "Show values"}
              title={revealed ? "Hide values" : "Show values"}
              onClick={() => setRevealed((value) => !value)}
              className={`grid size-6 place-items-center rounded-md hover:bg-content/8 ${
                revealed ? "text-content" : "text-content/45"
              }`}
            >
              <Eye className="size-3.5" />
            </button>
          </span>
          <span />
          {rows.map((row, index) => (
            <EnvRow
              key={index}
              row={row}
              index={index}
              revealed={revealed}
              autoFocus={index === rows.length - 1 && !row.name}
              onChange={(patch) => update(index, patch)}
              onPaste={(event) => paste(index, event)}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows((current) => [...current, EMPTY_ROW])}
          className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-content/70 hover:bg-content/8 hover:text-content active:scale-[0.97]"
        >
          <Plus className="size-3.5" />
          Add variable
        </button>
        {error ? (
          <span role="alert" className="text-[11px] text-red-400">
            {error}
          </span>
        ) : prefix ? (
          <code
            aria-label="Command preview"
            className={`block overflow-x-auto whitespace-pre rounded-md bg-content/5 px-2.5 py-2 font-mono text-[11px] text-content/70 ${
              revealed ? "" : "blur-[3px] hover:blur-none"
            }`}
          >
            {`${prefix} ${command}`}
          </code>
        ) : null}
        <span className="text-[11px] text-content/45">
          The agent starts with these variables, so its commands can use them.
          They are stored encrypted, with the key in the system keychain.
          {running
            ? " Saving stops the running agent; your next message resumes this conversation with them."
            : ""}
        </span>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 hover:bg-content/8 active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:brightness-110 active:scale-[0.97]"
          >
            {running ? "Save and restart" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EnvRow({
  row,
  index,
  revealed,
  autoFocus,
  onChange,
  onPaste,
  onRemove,
}: {
  row: SessionEnvRow;
  index: number;
  revealed: boolean;
  autoFocus: boolean;
  onChange: (patch: Partial<SessionEnvRow>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const label = row.name || `variable ${index + 1}`;
  return (
    <>
      <input
        autoFocus={autoFocus}
        value={row.name}
        aria-label={`Name of ${label}`}
        placeholder="API_TOKEN"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange({ name: event.target.value })}
        onPaste={onPaste}
        className={FIELD}
      />
      <input
        type={revealed ? "text" : "password"}
        value={row.value}
        aria-label={`Value of ${label}`}
        placeholder="value"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onChange={(event) => onChange({ value: event.target.value })}
        className={FIELD}
      />
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title="Remove"
        onClick={onRemove}
        className="grid size-8 place-items-center rounded-md text-content/45 hover:bg-red-400/10 hover:text-red-400 active:scale-[0.97]"
      >
        <Trash2 className="size-3.5" />
      </button>
    </>
  );
}
