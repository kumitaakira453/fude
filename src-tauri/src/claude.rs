use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

// Claude Code のセッションを読む（ベータ）。
//
// 一覧は `claude agents --json --all`（台本向けと明記された出口）から取り、
// そのセッションが書いたファイルは会話の記録（~/.claude/projects/**/<id>.jsonl）
// から拾う。どちらも公開された仕様ではないので、読めなければ Err を返して
// 画面に「読めません」と出すだけにする。ほかの機能は巻き込まない。

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub name: String,
    pub kind: String,
    // 動いているかどうか（busy / idle）。背景で終わったものには無い。
    pub status: Option<String>,
    // 背景セッションの段階（working / blocked / done）。
    pub state: Option<String>,
    pub cwd: Option<String>,
    pub started_at: Option<i64>,
    // 会話の記録の場所。見つからなければ None。
    pub transcript: Option<String>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

// GUI から起動すると PATH が通っていないので、置き場所を順に探す。
fn claude_bin() -> Option<PathBuf> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(h) = home() {
                candidates.push(h.join(".local/bin/claude"));
                candidates.push(h.join(".claude/local/claude"));
            }
            candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
            candidates.push(PathBuf::from("/usr/local/bin/claude"));
            if let Some(hit) = candidates.into_iter().find(|p| p.is_file()) {
                return Some(hit);
            }
            let out = Command::new("/bin/zsh")
                .args(["-lc", "command -v claude"])
                .output()
                .ok()?;
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!path.is_empty()).then(|| PathBuf::from(path))
        })
        .clone()
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

// 一覧の 1 件。sessionId と name が無いものは捨てる。
pub fn parse_sessions(list: &Value) -> Vec<Session> {
    list.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| {
                    Some(Session {
                        session_id: str_of(v, "sessionId")?,
                        name: str_of(v, "name").unwrap_or_default(),
                        kind: str_of(v, "kind").unwrap_or_default(),
                        status: str_of(v, "status"),
                        state: str_of(v, "state"),
                        cwd: str_of(v, "cwd"),
                        started_at: v.get("startedAt").and_then(Value::as_i64),
                        transcript: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// 会話の記録の場所。背景セッションは jobs/<短縮 ID>/state.json に書いてある。
// 無ければ projects の下を探す（worktree で動いたものは、場所の名前と cwd が一致しない）。
fn transcript_of(claude_dir: &Path, session_id: &str) -> Option<PathBuf> {
    let short: String = session_id.chars().take(8).collect();
    let state = claude_dir.join("jobs").join(&short).join("state.json");
    if let Some(path) = fs::read_to_string(state)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| str_of(&v, "linkScanPath"))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        return Some(path);
    }
    let name = format!("{session_id}.jsonl");
    fs::read_dir(claude_dir.join("projects"))
        .ok()?
        .flatten()
        .map(|e| e.path().join(&name))
        .find(|p| p.is_file())
}

// 見つけた claude コマンドの場所。見つからなければ None。設定の画面が、
// 読めているかを見せるのに使う。
#[tauri::command]
pub async fn claude_bin_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| claude_bin().map(|p| p.to_string_lossy().into_owned()))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn claude_sessions() -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = claude_bin().ok_or("claude コマンドが見つかりません")?;
        let out = Command::new(bin)
            .args(["agents", "--json", "--all"])
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("claude を起動できません: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "claude agents が失敗しました: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let list: Value = serde_json::from_slice(&out.stdout)
            .map_err(|e| format!("claude agents の出力を読めません: {e}"))?;
        let claude_dir = home().ok_or("HOME が設定されていません")?.join(".claude");
        Ok(parse_sessions(&list)
            .into_iter()
            .map(|mut s| {
                s.transcript = transcript_of(&claude_dir, &s.session_id)
                    .map(|p| p.to_string_lossy().into_owned());
                s
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- 書いたファイル ----

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Wrote {
    pub path: String,
    pub at: i64,
}

// 1 つの記録をどこまで読んだか。書く道具を呼んだ（結果待ちの）ものも持ち越す。
#[derive(Default)]
struct Cursor {
    offset: u64,
    pending: HashMap<String, (String, i64)>,
}

#[derive(Default)]
pub struct Scan {
    cursors: HashMap<PathBuf, Cursor>,
    wrote: Vec<Wrote>,
}

static SCANS: Mutex<Option<HashMap<String, Scan>>> = Mutex::new(None);

const WRITERS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

// fude で開けるもの。
const SHOWN: [&str; 19] = [
    "md", "markdown", "mdx", "mdown", "mkd", "csv", "tsv", "json", "html", "htm", "txt", "pdf",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ipynb",
];

fn shown(path: &str) -> bool {
    // 記憶や道具の出力の置き場（~/.claude/projects）は、書いたものとして見せない。
    if path.contains("/.claude/projects/") {
        return false;
    }
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| SHOWN.contains(&e.to_ascii_lowercase().as_str()))
}

// "2026-10-05T11:42:11.092Z" をミリ秒に。読めなければ 0。
pub fn iso_ms(text: &str) -> i64 {
    let b = text.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        text.get(from..from + len)?.parse().ok()
    };
    if b.len() < 19 {
        return 0;
    }
    let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(s)) = (
        num(0, 4),
        num(5, 2),
        num(8, 2),
        num(11, 2),
        num(14, 2),
        num(17, 2),
    ) else {
        return 0;
    };
    let ms = if b.get(19) == Some(&b'.') { num(20, 3).unwrap_or(0) } else { 0 };
    // 暦日から通日（1970-01-01 起点）。
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    ((days * 24 + h) * 60 + mi) * 60_000 + s * 1000 + ms
}

// 記録の 1 行を読む。書く道具を呼んだ行は控え、その結果の行で成否を見る。
// 拒まれたもの・失敗したものは書いていないので拾わない。
fn take_line(line: &str, cursor: &mut Cursor, out: &mut Vec<Wrote>) {
    let calls = line.contains("\"tool_use\"");
    let results = line.contains("\"tool_result\"");
    if !calls && !results {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let at = v.get("timestamp").and_then(Value::as_str).map(iso_ms).unwrap_or(0);
    let Some(items) = v.pointer("/message/content").and_then(Value::as_array) else {
        return;
    };
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("tool_use") => {
                let name = item.get("name").and_then(Value::as_str).unwrap_or("");
                if !WRITERS.contains(&name) {
                    continue;
                }
                let input = item.get("input");
                let path = input
                    .and_then(|i| i.get("file_path").or_else(|| i.get("notebook_path")))
                    .and_then(Value::as_str);
                if let (Some(id), Some(path)) = (item.get("id").and_then(Value::as_str), path) {
                    cursor.pending.insert(id.to_string(), (path.to_string(), at));
                }
            }
            Some("tool_result") => {
                let Some(id) = item.get("tool_use_id").and_then(Value::as_str) else {
                    continue;
                };
                let Some((path, called)) = cursor.pending.remove(id) else {
                    continue;
                };
                let failed = item.get("is_error").and_then(Value::as_bool) == Some(true);
                let done = v.get("toolUseResult").is_some_and(Value::is_object);
                if !failed && done && shown(&path) {
                    out.push(Wrote {
                        path,
                        at: if at > 0 { at } else { called },
                    });
                }
            }
            _ => {}
        }
    }
}

// 前回の続きから読む。最後の改行より後ろ（書きかけの行）は次に回す。
fn read_more(file: &Path, cursor: &mut Cursor, out: &mut Vec<Wrote>) -> std::io::Result<()> {
    let mut f = File::open(file)?;
    let len = f.metadata()?.len();
    if len < cursor.offset {
        // 縮んだ（作り直された）なら頭から読み直す。
        *cursor = Cursor::default();
    }
    if len == cursor.offset {
        return Ok(());
    }
    f.seek(SeekFrom::Start(cursor.offset))?;
    let mut bytes = Vec::with_capacity((len - cursor.offset) as usize);
    f.take(len - cursor.offset).read_to_end(&mut bytes)?;
    let Some(end) = bytes.iter().rposition(|&b| b == b'\n') else {
        return Ok(());
    };
    for line in String::from_utf8_lossy(&bytes[..=end]).lines() {
        take_line(line, cursor, out);
    }
    cursor.offset += end as u64 + 1;
    Ok(())
}

// 本体の記録と、その下の subagent の記録（<id>/subagents/**/*.jsonl）。
fn transcripts(main: &Path) -> Vec<PathBuf> {
    let mut list = vec![main.to_path_buf()];
    let Some(stem) = main.file_stem() else {
        return list;
    };
    let mut stack = vec![main.with_file_name(stem).join("subagents")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "jsonl") {
                list.push(p);
            }
        }
    }
    list
}

// 同じファイルは最後に書いた時刻だけを残し、新しい順に並べる。
fn merge(list: &mut Vec<Wrote>) {
    let mut last: HashMap<String, i64> = HashMap::new();
    for w in list.iter() {
        let at = last.entry(w.path.clone()).or_insert(w.at);
        *at = (*at).max(w.at);
    }
    let mut out: Vec<Wrote> = last.into_iter().map(|(path, at)| Wrote { path, at }).collect();
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.path.cmp(&b.path)));
    *list = out;
}

#[derive(Debug, Serialize)]
pub struct SessionFiles {
    pub wrote: Vec<Wrote>,
    // 記録のファイルが無い（消された）。
    pub gone: bool,
}

pub fn scan_session(session_id: &str, transcript: &Path) -> SessionFiles {
    if !transcript.is_file() {
        return SessionFiles {
            wrote: Vec::new(),
            gone: true,
        };
    }
    let mut guard = SCANS.lock().unwrap_or_else(|e| e.into_inner());
    let scans = guard.get_or_insert_with(HashMap::new);
    let scan = scans.entry(session_id.to_string()).or_default();
    let mut fresh = Vec::new();
    for file in transcripts(transcript) {
        let cursor = scan.cursors.entry(file.clone()).or_default();
        if let Err(e) = read_more(&file, cursor, &mut fresh) {
            log::warn!("{} を読めません: {e}", file.display());
        }
    }
    if !fresh.is_empty() {
        scan.wrote.extend(fresh);
        merge(&mut scan.wrote);
    }
    SessionFiles {
        wrote: scan.wrote.clone(),
        gone: false,
    }
}

#[tauri::command]
pub async fn claude_session_files(
    session_id: String,
    transcript: String,
) -> Result<SessionFiles, String> {
    tauri::async_runtime::spawn_blocking(move || scan_session(&session_id, Path::new(&transcript)))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const CALL_WRITE: &str = r#"{"type":"assistant","timestamp":"2026-10-05T11:42:11.092Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/w/a.md","content":"x"}}]}}"#;
    const OK_WRITE: &str = r#"{"type":"user","timestamp":"2026-10-05T11:42:12.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]},"toolUseResult":{"type":"create","filePath":"/w/a.md"}}"#;
    const CALL_EDIT: &str = r#"{"type":"assistant","timestamp":"2026-10-05T11:43:00.000Z","message":{"content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/w/b.md"}}]}}"#;
    const FAIL_EDIT: &str = r#"{"type":"user","timestamp":"2026-10-05T11:43:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t2","is_error":true,"content":"Error"}]},"toolUseResult":"Error: no"}"#;
    const CALL_DENIED: &str = r#"{"type":"assistant","timestamp":"2026-10-05T11:44:00.000Z","message":{"content":[{"type":"tool_use","id":"t3","name":"Write","input":{"file_path":"/w/c.md"}}]}}"#;
    const DENIED: &str = r#"{"type":"user","timestamp":"2026-10-05T11:44:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t3","is_error":true,"content":"The user doesn't want to proceed"}]},"toolUseResult":"The user doesn't want to proceed"}"#;
    const CALL_CODE: &str = r#"{"type":"assistant","timestamp":"2026-10-05T11:45:00.000Z","message":{"content":[{"type":"tool_use","id":"t4","name":"Write","input":{"file_path":"/w/main.rs"}}]}}"#;
    const OK_CODE: &str = r#"{"type":"user","timestamp":"2026-10-05T11:45:01.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t4","content":"ok"}]},"toolUseResult":{"filePath":"/w/main.rs"}}"#;
    const TITLE: &str = r#"{"type":"custom-title","customTitle":"x","sessionId":"s"}"#;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fude-claude-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn lines(file: &Path, rows: &[&str]) {
        let mut f = fs::OpenOptions::new().create(true).append(true).open(file).unwrap();
        for row in rows {
            writeln!(f, "{row}").unwrap();
        }
    }

    #[test]
    fn 時刻を読む() {
        assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), 0);
        assert_eq!(iso_ms("2026-10-05T11:42:11.092Z"), 1_791_200_531_092);
        assert_eq!(iso_ms("壊れた"), 0);
    }

    #[test]
    fn 書けたものだけを拾い_失敗と拒否と開けないものは拾わない() {
        let dir = temp("pick");
        let main = dir.join("s1.jsonl");
        lines(
            &main,
            &[CALL_WRITE, OK_WRITE, CALL_EDIT, FAIL_EDIT, CALL_DENIED, DENIED, CALL_CODE, OK_CODE, TITLE],
        );
        let got = scan_session("pick", &main);
        assert!(!got.gone);
        assert_eq!(
            got.wrote,
            vec![Wrote {
                path: "/w/a.md".into(),
                at: 1_791_200_532_000
            }]
        );
    }

    #[test]
    fn 続きから読み_結果が後の回に届いても組める() {
        let dir = temp("tail");
        let main = dir.join("s2.jsonl");
        lines(&main, &[CALL_WRITE]);
        assert!(scan_session("tail", &main).wrote.is_empty());
        lines(&main, &[OK_WRITE]);
        assert_eq!(scan_session("tail", &main).wrote.len(), 1);
        // 同じものを読み直して数が増えない。
        assert_eq!(scan_session("tail", &main).wrote.len(), 1);
    }

    #[test]
    fn 書きかけの行は次に回す() {
        let dir = temp("half");
        let main = dir.join("s3.jsonl");
        lines(&main, &[CALL_WRITE]);
        let mut f = fs::OpenOptions::new().append(true).open(&main).unwrap();
        write!(f, "{}", &OK_WRITE[..40]).unwrap();
        assert!(scan_session("half", &main).wrote.is_empty());
        writeln!(f, "{}", &OK_WRITE[40..]).unwrap();
        assert_eq!(scan_session("half", &main).wrote.len(), 1);
    }

    #[test]
    fn subagent_が書いたものも拾う() {
        let dir = temp("sub");
        let main = dir.join("s4.jsonl");
        lines(&main, &[TITLE]);
        let sub = dir.join("s4").join("subagents").join("workflows").join("wf_1");
        fs::create_dir_all(&sub).unwrap();
        lines(&sub.join("agent-1.jsonl"), &[CALL_WRITE, OK_WRITE]);
        assert_eq!(scan_session("sub", &main).wrote[0].path, "/w/a.md");
    }

    #[test]
    fn 記録が無ければ消えたと返す() {
        let dir = temp("gone");
        assert!(scan_session("gone", &dir.join("none.jsonl")).gone);
    }

    #[test]
    fn 一覧は_id_の無いものを捨てる() {
        let list: Value = serde_json::from_str(
            r#"[{"sessionId":"a","name":"[V]x","kind":"background","state":"blocked","startedAt":5},{"name":"no id"}]"#,
        )
        .unwrap();
        let got = parse_sessions(&list);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].state.as_deref(), Some("blocked"));
        assert_eq!(got[0].status, None);
    }
}
