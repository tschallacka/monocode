//! Sessions started in the Claude Code CLI, listed so MonoCode can pick one up:
//! open it in its own working directory and resume the same conversation.
//! Transcripts live at `<config>/projects/<encoded cwd>/<session id>.jsonl`;
//! the folder name loses information, so the `cwd` comes from the records.

use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::fs::{claude_config_dir, find_claude_transcript};

/// The longest first prompt kept as a fallback title.
const TITLE_CHARS: usize = 120;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSession {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub git_branch: Option<String>,
    pub started_at: Option<String>,
    pub last_at: Option<String>,
    /// Epoch ms the transcript was last written: a recent one may still be live.
    pub modified_ms: u64,
}

fn is_session_id(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn first_prompt(record: &Value) -> Option<String> {
    if record.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let content = record.pointer("/message/content")?;
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    // Command and hook wrappers are not what the person typed.
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') {
        return None;
    }
    Some(text.chars().take(TITLE_CHARS).collect())
}

/// How much of a transcript's end is read for its latest title and activity.
const TAIL_BYTES: u64 = 1 << 20;
/// Lines read from the start, at most, while looking for the cwd and prompt.
const HEAD_LINES: usize = 2_000;

/// A record's `"key":"…"` string value, read without parsing the line.
fn string_in<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("\"{key}\":\"");
    let start = line.find(&marker)? + marker.len();
    let len = line[start..].find('"')?;
    Some(&line[start..start + len])
}

/// What one transcript's lines say about it, gathered from its head and tail.
#[derive(Default)]
struct Scan {
    cwd: Option<String>,
    git_branch: Option<String>,
    started_at: Option<String>,
    last_at: Option<String>,
    custom_title: Option<String>,
    ai_title: Option<String>,
    prompt: Option<String>,
}

impl Scan {
    fn head_done(&self) -> bool {
        self.cwd.is_some() && self.prompt.is_some()
    }

    /// A line is parsed only for a title, or for the cwd and first prompt
    /// while they are missing; timestamps and branch are read off the text.
    fn line(&mut self, line: &str) {
        let is_title = line.contains("\"custom-title\"") || line.contains("\"ai-title\"");
        let is_message =
            line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"");
        let main_thread = is_message && !line.contains("\"isSidechain\":true");
        if main_thread {
            if let Some(at) = string_in(line, "timestamp") {
                self.started_at.get_or_insert_with(|| at.to_owned());
                self.last_at = Some(at.to_owned());
            }
            if let Some(branch) = string_in(line, "gitBranch") {
                self.git_branch = Some(branch.to_owned());
            }
        }
        if !(is_title || (main_thread && !self.head_done())) {
            return;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let text = |key: &str| record.get(key).and_then(Value::as_str).map(str::to_owned);
        match record.get("type").and_then(Value::as_str) {
            Some("custom-title") => self.custom_title = text("customTitle"),
            Some("ai-title") => self.ai_title = text("aiTitle"),
            Some(kind @ ("user" | "assistant")) => {
                if self.cwd.is_none() {
                    self.cwd = text("cwd");
                }
                if kind == "user" && self.prompt.is_none() {
                    self.prompt = first_prompt(&record);
                }
            }
            _ => {}
        }
    }
}

/// One transcript's summary, or `None` when it holds no conversation. Only
/// its head (cwd, first prompt) and its last MB (latest title, last activity)
/// are read: transcripts run to hundreds of MB.
pub(crate) fn summarize_transcript(path: &Path) -> Option<ClaudeCodeSession> {
    let id = path.file_stem()?.to_str()?.to_owned();
    if !is_session_id(&id) {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let mut scan = Scan::default();
    let head = BufReader::new(std::fs::File::open(path).ok()?);
    for line in head.lines().map_while(Result::ok).take(HEAD_LINES) {
        scan.line(&line);
        if scan.head_done() {
            break;
        }
    }

    let mut tail = BufReader::new(std::fs::File::open(path).ok()?);
    let offset = meta.len().saturating_sub(TAIL_BYTES);
    if offset > 0 {
        tail.seek(SeekFrom::Start(offset)).ok()?;
        // The seek lands mid-line: that partial line is not a record.
        tail.read_until(b'\n', &mut Vec::new()).ok()?;
    }
    for line in tail.lines().map_while(Result::ok) {
        scan.line(&line);
    }

    let cwd = scan.cwd?;
    let title = scan
        .custom_title
        .or(scan.ai_title)
        .or(scan.prompt)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| "Claude Code session".to_owned());
    Some(ClaudeCodeSession {
        id,
        cwd,
        title,
        git_branch: scan.git_branch.filter(|branch| !branch.is_empty()),
        started_at: scan.started_at,
        last_at: scan.last_at,
        modified_ms,
    })
}

/// Every session in `<config>/projects`, newest first, at most `limit`.
pub(crate) fn list_sessions(config_dir: &Path, limit: usize) -> Vec<ClaudeCodeSession> {
    let Ok(projects) = std::fs::read_dir(config_dir.join("projects")) else {
        return Vec::new();
    };
    // Top-level `<id>.jsonl` only: `<id>/subagents/*.jsonl` are a session's agents.
    let mut files: Vec<_> = projects
        .flatten()
        .filter_map(|project| std::fs::read_dir(project.path()).ok())
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|path| {
            let modified = std::fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .ok()?;
            Some((modified, path))
        })
        .collect();
    files.sort_by_key(|file| std::cmp::Reverse(file.0));
    files
        .into_iter()
        .filter_map(|(_, path)| summarize_transcript(&path))
        .take(limit)
        .collect()
}

/// What MonoCode keeps of a tool's output, as its transcript does.
const TOOL_RESULT_CHARS: usize = 8_000;

fn capped(text: &str) -> String {
    text.chars().take(TOOL_RESULT_CHARS).collect()
}

/// A content block as the transcript import reads it: images and signatures
/// dropped, a tool result's text capped. `None` drops the block.
fn slim_block(block: &Value) -> Option<Value> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => Some(serde_json::json!({ "type": "text", "text": block.get("text")? })),
        "thinking" => Some(serde_json::json!({
            "type": "thinking",
            "thinking": block.get("thinking")?,
        })),
        "tool_use" => Some(serde_json::json!({
            "type": "tool_use",
            "id": block.get("id")?,
            "name": block.get("name")?,
            "input": block.get("input").cloned().unwrap_or(Value::Null),
        })),
        "tool_result" => {
            let content = match block.get("content") {
                Some(Value::String(text)) => Value::String(capped(text)),
                Some(Value::Array(parts)) => Value::Array(
                    parts
                        .iter()
                        .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|part| part.get("text").and_then(Value::as_str))
                        .map(|text| serde_json::json!({ "type": "text", "text": capped(text) }))
                        .collect(),
                ),
                _ => Value::Null,
            };
            Some(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": block.get("tool_use_id")?,
                "is_error": block.get("is_error").cloned().unwrap_or(Value::Bool(false)),
                "content": content,
            }))
        }
        _ => None,
    }
}

/// A `user` or `assistant` record cut to what the import reads, so a
/// transcript of hundreds of MB crosses to the page as a fraction of that.
fn slim_record(record: &Value) -> Value {
    let message = record.get("message");
    let content = match message.and_then(|message| message.get("content")) {
        Some(Value::String(text)) => Value::String(text.clone()),
        Some(Value::Array(blocks)) => Value::Array(blocks.iter().filter_map(slim_block).collect()),
        _ => Value::Null,
    };
    let mut slim = serde_json::json!({
        "type": record.get("type"),
        "message": {
            "id": message.and_then(|message| message.get("id")),
            "content": content,
        },
    });
    for key in ["timestamp", "isMeta", "isCompactSummary"] {
        if let Some(value) = record.get(key) {
            slim[key] = value.clone();
        }
    }
    slim
}

/// The main thread's `user` and `assistant` records, in order, for MonoCode to
/// turn into transcript blocks. Subagent (sidechain) records stay out.
pub(crate) fn transcript_records(path: &Path) -> Result<Vec<Value>, String> {
    read_records(path, false)
}

/// A file's `user` and `assistant` records, slimmed. A subagent's own file is
/// all sidechain, so it is read with `sidechain` set.
fn read_records(path: &Path, sidechain: bool) -> Result<Vec<Value>, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|line| {
            (line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\""))
                && (sidechain || !line.contains("\"isSidechain\":true"))
        })
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter(|record| {
            matches!(
                record.get("type").and_then(Value::as_str),
                Some("user" | "assistant")
            ) && (sidechain || record.get("isSidechain").and_then(Value::as_bool) != Some(true))
        })
        .map(|record| slim_record(&record))
        .collect())
}

/// The transcript of the subagent the Agent call `tool_use_id` spawned.
/// Claude Code writes it beside the session's own file, as
/// `<session>/subagents/agent-<id>.jsonl`, with a `.meta.json` naming the call.
fn find_subagent_transcript(transcript: &Path, tool_use_id: &str) -> Option<PathBuf> {
    let folder = transcript.with_extension("").join("subagents");
    std::fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find_map(|meta| {
            let name = meta.file_name()?.to_str()?;
            let agent = name.strip_suffix(".meta.json")?;
            let text = std::fs::read_to_string(&meta).ok()?;
            let value: Value = serde_json::from_str(&text).ok()?;
            (value.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id))
                .then(|| meta.with_file_name(format!("{agent}.jsonl")))
        })
        .filter(|path| path.is_file())
}

/// One subagent run of a session, as its `.meta.json` and file describe it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentRun {
    pub agent_id: String,
    /// The Agent call that spawned it, in its parent's transcript.
    pub tool_use_id: String,
    /// The run that spawned it; `None` for one the session spawned itself.
    pub parent_agent_id: Option<String>,
    pub description: Option<String>,
    pub agent_type: Option<String>,
    pub depth: u32,
    /// Claude Code marks a run finished; older versions never did.
    pub finished: bool,
    /// Epoch ms its transcript was last written.
    pub modified_ms: u64,
}

/// Every subagent run of the session whose transcript is `transcript`, at any
/// depth: Claude Code keeps them all in one folder, linked by `parentAgentId`.
fn subagent_runs(transcript: &Path) -> Vec<SubagentRun> {
    let folder = transcript.with_extension("").join("subagents");
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter_map(|meta| {
            let agent = meta.file_name()?.to_str()?.strip_suffix(".meta.json")?;
            let value: Value = serde_json::from_str(&std::fs::read_to_string(&meta).ok()?).ok()?;
            let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
            let modified_ms = std::fs::metadata(meta.with_file_name(format!("{agent}.jsonl")))
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_millis() as u64);
            Some(SubagentRun {
                agent_id: agent.strip_prefix("agent-").unwrap_or(agent).to_string(),
                tool_use_id: text("toolUseId")?,
                parent_agent_id: text("parentAgentId"),
                description: text("description"),
                agent_type: text("agentType"),
                depth: value.get("spawnDepth").and_then(Value::as_u64).unwrap_or(1) as u32,
                finished: value.get("finished").and_then(Value::as_bool) == Some(true),
                modified_ms,
            })
        })
        .collect()
}

fn is_tool_use_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[tauri::command(async)]
pub fn claude_code_sessions(
    app: AppHandle,
    provider_account_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ClaudeCodeSession>, String> {
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    Ok(list_sessions(&config_dir, limit.unwrap_or(200)))
}

#[tauri::command(async)]
pub fn claude_code_transcript(
    app: AppHandle,
    provider_account_id: Option<String>,
    session_id: String,
) -> Result<Vec<Value>, String> {
    if !is_session_id(&session_id) {
        return Err("Invalid Claude session id".into());
    }
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    let path = find_claude_transcript(&config_dir, &session_id)
        .ok_or("That Claude Code session's transcript is gone")?;
    transcript_records(&path)
}

/// A subagent's whole run, read from its own transcript, or `None` while
/// Claude Code has not written it (or the session predates such files).
#[tauri::command(async)]
pub fn claude_subagent_transcript(
    app: AppHandle,
    provider_account_id: Option<String>,
    session_id: String,
    tool_use_id: String,
) -> Result<Option<Vec<Value>>, String> {
    if !is_session_id(&session_id) || !is_tool_use_id(&tool_use_id) {
        return Err("Invalid Claude session or tool call id".into());
    }
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    let Some(transcript) = find_claude_transcript(&config_dir, &session_id) else {
        return Ok(None);
    };
    match find_subagent_transcript(&transcript, &tool_use_id) {
        Some(path) => read_records(&path, true).map(Some),
        None => Ok(None),
    }
}

/// The session's subagent runs at every depth, for the tree of live ones.
#[tauri::command(async)]
pub fn claude_subagent_runs(
    app: AppHandle,
    provider_account_id: Option<String>,
    session_id: String,
) -> Result<Vec<SubagentRun>, String> {
    if !is_session_id(&session_id) {
        return Err("Invalid Claude session id".into());
    }
    let config_dir = claude_config_dir(&app, provider_account_id.as_deref())?;
    Ok(find_claude_transcript(&config_dir, &session_id)
        .map(|transcript| subagent_runs(&transcript))
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path, project: &str, id: &str, lines: &[&str]) -> std::path::PathBuf {
        let folder = dir.join("projects").join(project);
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("{id}.jsonl"));
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "monocode-claude-code-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn finds_a_subagent_run_by_the_agent_call_that_spawned_it() {
        let dir = temp_dir("subagents");
        let transcript = fixture(&dir, "-Users-me-shop", "bbbb-2222", &[]);
        let folder = transcript.with_extension("").join("subagents");
        std::fs::create_dir_all(&folder).unwrap();
        for (agent, call) in [("agent-a1", "toolu_one"), ("agent-a2", "toolu_two")] {
            std::fs::write(
                folder.join(format!("{agent}.meta.json")),
                format!(r#"{{"agentType":"code-researcher","toolUseId":"{call}"}}"#),
            )
            .unwrap();
            std::fs::write(
                folder.join(format!("{agent}.jsonl")),
                [
                    format!(r#"{{"type":"user","isSidechain":true,"message":{{"content":"Brief for {call}"}}}}"#),
                    r#"{"type":"attachment","isSidechain":true}"#.to_string(),
                    r#"{"type":"assistant","isSidechain":true,"message":{"id":"m1","content":[{"type":"text","text":"Found it"}]}}"#.to_string(),
                ]
                .join("\n"),
            )
            .unwrap();
        }

        let path = find_subagent_transcript(&transcript, "toolu_two").unwrap();
        assert_eq!(path, folder.join("agent-a2.jsonl"));
        let records = read_records(&path, true).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["message"]["content"], "Brief for toolu_two");
        // The main-thread reader still leaves a sidechain file's records out.
        assert!(transcript_records(&path).unwrap().is_empty());
        assert!(find_subagent_transcript(&transcript, "toolu_missing").is_none());
        assert!(!is_tool_use_id("../agent"));

        std::fs::write(
            folder.join("agent-a3.meta.json"),
            r#"{"agentType":"fork","toolUseId":"toolu_three","parentAgentId":"a2","spawnDepth":2,"finished":true,"description":"Nested audit"}"#,
        )
        .unwrap();
        std::fs::write(
            folder.join("agent-a3.jsonl"),
            r#"{"type":"user","isSidechain":true,"message":{"content":"Nested brief"}}"#,
        )
        .unwrap();
        let mut runs = subagent_runs(&transcript);
        runs.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[0].agent_id, "a1");
        assert_eq!(runs[0].parent_agent_id, None);
        assert_eq!(runs[0].depth, 1);
        assert!(!runs[0].finished);
        assert!(runs[0].modified_ms > 0);
        assert_eq!(runs[2].tool_use_id, "toolu_three");
        assert_eq!(runs[2].parent_agent_id.as_deref(), Some("a2"));
        assert_eq!(runs[2].depth, 2);
        assert!(runs[2].finished);
        // A nested run's transcript is found by its own Agent call too.
        assert_eq!(
            find_subagent_transcript(&transcript, "toolu_three"),
            Some(folder.join("agent-a3.jsonl"))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn summarizes_cwd_title_branch_and_times_from_the_records() {
        let dir = temp_dir("summary");
        fixture(
            &dir,
            "-Users-me-www-shop",
            "aaaa-1111",
            &[
                r#"{"type":"queue-operation","sessionId":"aaaa-1111"}"#,
                r#"{"type":"user","isMeta":true,"cwd":"/Users/me/www/shop","message":{"content":"<command-name>"},"timestamp":"2026-10-22T08:00:00Z"}"#,
                "not json at all",
                r#"{"type":"user","cwd":"/Users/me/www/shop","gitBranch":"feature/x","message":{"content":[{"type":"text","text":"Fix the cart total"}]},"timestamp":"2026-10-22T08:01:00Z"}"#,
                r#"{"type":"assistant","isSidechain":true,"cwd":"/elsewhere","timestamp":"2026-10-22T09:00:00Z"}"#,
                r#"{"type":"assistant","cwd":"/Users/me/www/shop","gitBranch":"feature/x","timestamp":"2026-10-22T08:02:00Z"}"#,
                r#"{"type":"ai-title","aiTitle":"Cart total fix","sessionId":"aaaa-1111"}"#,
            ],
        );
        let sessions = list_sessions(&dir, 10);
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert_eq!(session.id, "aaaa-1111");
        assert_eq!(session.cwd, "/Users/me/www/shop");
        assert_eq!(session.title, "Cart total fix");
        assert_eq!(session.git_branch.as_deref(), Some("feature/x"));
        assert_eq!(session.started_at.as_deref(), Some("2026-10-22T08:00:00Z"));
        assert_eq!(session.last_at.as_deref(), Some("2026-10-22T08:02:00Z"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefers_a_custom_title_and_falls_back_to_the_first_prompt() {
        let dir = temp_dir("titles");
        let named = fixture(
            &dir,
            "p",
            "named",
            &[
                r#"{"type":"user","cwd":"/a","message":{"content":"hello there"}}"#,
                r#"{"type":"ai-title","aiTitle":"Generated"}"#,
                r#"{"type":"custom-title","customTitle":"Mine"}"#,
            ],
        );
        let plain = fixture(
            &dir,
            "p",
            "plain",
            &[r#"{"type":"user","cwd":"/a","message":{"content":"hello there"}}"#],
        );
        assert_eq!(summarize_transcript(&named).unwrap().title, "Mine");
        assert_eq!(summarize_transcript(&plain).unwrap().title, "hello there");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_files_without_a_conversation_and_subagent_transcripts() {
        let dir = temp_dir("skips");
        fixture(&dir, "p", "empty", &[r#"{"type":"queue-operation"}"#]);
        let agent_dir = dir.join("projects/p/main/subagents");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(
            agent_dir.join("agent-1.jsonl"),
            r#"{"type":"user","cwd":"/a","message":{"content":"hi"}}"#,
        )
        .unwrap();
        assert!(list_sessions(&dir, 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn slims_records_to_what_the_import_reads() {
        let dir = temp_dir("slim");
        let long = "x".repeat(TOOL_RESULT_CHARS + 500);
        let user = serde_json::json!({
            "type": "user",
            "timestamp": "2026-10-22T08:00:00Z",
            "toolUseResult": { "stdout": long },
            "message": { "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "t1", "content": [
                    { "type": "text", "text": long },
                    { "type": "image", "source": { "data": "AAAA" } }
                ]},
                { "type": "image", "source": { "data": "BBBB" } }
            ]}
        });
        let assistant = serde_json::json!({
            "type": "assistant",
            "message": { "id": "m1", "content": [
                { "type": "thinking", "thinking": "plan", "signature": "sig" }
            ]}
        });
        let path = fixture(&dir, "p", "s", &[&user.to_string(), &assistant.to_string()]);
        let records = transcript_records(&path).unwrap();
        assert!(records[0].get("toolUseResult").is_none());
        let blocks = records[0]["message"]["content"].as_array().unwrap();
        assert_eq!(blocks.len(), 1, "the prompt image is dropped");
        let parts = blocks[0]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 1, "the result image is dropped");
        assert_eq!(parts[0]["text"].as_str().unwrap().len(), TOOL_RESULT_CHARS);
        assert_eq!(records[0]["timestamp"], "2026-10-22T08:00:00Z");
        let thinking = &records[1]["message"]["content"][0];
        assert_eq!(thinking["thinking"], "plan");
        assert!(thinking.get("signature").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_only_main_thread_messages_for_the_transcript() {
        let dir = temp_dir("records");
        let path = fixture(
            &dir,
            "p",
            "s",
            &[
                r#"{"type":"user","message":{"content":"hi"}}"#,
                r#"{"type":"assistant","isSidechain":true,"message":{"content":[]}}"#,
                r#"{"type":"ai-title","aiTitle":"x"}"#,
                r#"{"type":"assistant","message":{"content":[]}}"#,
            ],
        );
        let records = transcript_records(&path).unwrap();
        let kinds: Vec<_> = records
            .iter()
            .map(|record| record["type"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["user", "assistant"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
