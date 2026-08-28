pub mod format;
pub mod import;
pub mod snapshot;
pub mod store;

use std::fs;
use std::path::{Path, PathBuf};

use store::{Comment, Ledger, Origin, Status, Thread, Version};

// GUI（Tauri コマンド）と CLI が共通で呼ぶ操作層。
// Markdown の解析は一切しない。指摘が今の版でどこに対応するかは GUI が
// 基準版との対応付けで求めて台帳に控えるので、ここでは控えを読むだけで済む。

// 指摘そのものの状態。人間が解決したかどうかだけを表す。
// 対象が書き換わったかどうかとは独立。
pub use store::Status as ThreadStatus;

// 指摘の対象が今の版でどうなっているか。ThreadStatus（未解決 / 解決済み）とは
// 別の軸で扱う。1 つの列挙にまとめると、書き換わった指摘が未解決の一覧から
// 抜け落ちてフィードバックが黙って消える。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnchorState {
    Unchanged, // 指摘した箇所は書き換わっていない
    Rewritten, // 書き換わった。現在の本文は head_quote にある
    Removed,   // 削除された
    Unknown,   // 対応付けができていない
    NoFile,    // ファイル自体が見つからない
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ThreadView {
    pub thread: Thread,
    pub anchor: AnchorState,
    pub head_quote: Option<String>, // 現在のブロック本文（控えから）
    pub cache_fresh: bool,          // 控えが今のファイルと合っているか
    pub base: Option<Version>,      // 指摘した時点の版
    pub latest: Option<Version>,    // そのファイルの最新の版
}

#[derive(Debug, Clone, Default)]
pub struct Filter {
    pub project: Option<PathBuf>,
    pub file: Option<PathBuf>,
    pub include_resolved: bool,
}

// ---- 参照 ----

pub fn list(filter: &Filter) -> Result<Vec<ThreadView>, String> {
    let ledger = store::load()?;
    let project = filter
        .project
        .as_ref()
        .map(|p| normalize(p))
        .transpose()?;
    let file = filter.file.as_ref().map(|p| normalize(p)).transpose()?;

    let mut views = Vec::new();
    for thread in &ledger.threads {
        if !filter.include_resolved && matches!(thread.status, Status::Resolved { .. }) {
            continue;
        }
        if let Some(ref f) = file {
            if &thread.file != f {
                continue;
            }
        }
        if let Some(ref dir) = project {
            if !under(&thread.file, dir) {
                continue;
            }
        }
        let (anchor, head_quote, cache_fresh) = resolve_view(thread);
        views.push(ThreadView {
            anchor,
            head_quote,
            cache_fresh,
            base: ledger
                .versions
                .iter()
                .find(|v| v.id == thread.base_version && v.file == thread.file)
                .cloned(),
            latest: ledger.latest_version(&thread.file).cloned(),
            thread: thread.clone(),
        });
    }
    views.sort_by(|a, b| {
        a.thread
            .file
            .cmp(&b.thread.file)
            .then(a.thread.created_at.cmp(&b.thread.created_at))
    });
    Ok(views)
}

pub fn versions(file: &Path) -> Result<Vec<Version>, String> {
    let key = normalize(file)?;
    let ledger = store::load()?;
    Ok(ledger
        .versions_of(&key)
        .into_iter()
        .cloned()
        .collect::<Vec<_>>())
}

// 指摘が今どうなっているかを求める。位置の対応付けは GUI が済ませて台帳に
// 控えているので、ここでは控えを読むだけ。Markdown の解析はしない。
//
// 控えの「現在のブロック本文」がまだファイルに含まれていれば控えは最新。
// 含まれていなければ、GUI が最後に見たあとで本文が変わっている。
fn resolve_view(thread: &Thread) -> (AnchorState, Option<String>, bool) {
    let text = match fs::read_to_string(&thread.file) {
        Ok(text) => text,
        Err(_) => return (AnchorState::NoFile, None, false),
    };

    match &thread.resolved {
        Some(resolved) => {
            let state = match resolved.state.as_str() {
                "unchanged" => AnchorState::Unchanged,
                "rewritten" => AnchorState::Rewritten,
                "removed" => AnchorState::Removed,
                _ => AnchorState::Unknown,
            };
            if resolved.head_quote.is_empty() {
                return (state, None, true);
            }
            let fresh = text.contains(&resolved.head_quote);
            (state, Some(resolved.head_quote.clone()), fresh)
        }
        None => {
            // GUI が一度も対応付けていない。引用がまだ残っているかだけ分かる。
            if text.contains(&thread.quote) {
                (AnchorState::Unchanged, Some(thread.quote.clone()), true)
            } else {
                (AnchorState::Unknown, None, false)
            }
        }
    }
}

pub const RESOLVED_STATES: [&str; 4] = ["unchanged", "rewritten", "removed", "unknown"];

// GUI が求めた対応付けの結果を控える。
pub fn set_resolved(thread_id: &str, state: &str, head_quote: &str) -> Result<(), String> {
    if !RESOLVED_STATES.contains(&state) {
        return Err(format!("解決状態が不正です: {state}"));
    }
    let now = store::now_millis();
    store::update(|ledger: &mut Ledger| {
        let thread = ledger
            .thread_mut(thread_id)
            .ok_or_else(|| format!("指摘 {thread_id} が見つかりません"))?;
        thread.resolved = Some(store::Resolved {
            state: state.to_string(),
            head_quote: head_quote.to_string(),
            at: now,
        });
        Ok(())
    })
}

// ---- 更新 ----

pub struct NewThread {
    pub file: PathBuf,
    pub quote: String,
    pub selection: String,
    pub selection_offset: usize,
    pub section_path: Vec<String>,
    // 指摘した時点で画面に出ていた本文そのもの。これを版として保存するので、
    // 指摘と版が構成上必ず一致する（ディスクの内容とずれていても矛盾しない）。
    pub source: String,
    pub author: String,
    pub body: String,
}

pub fn create_thread(input: NewThread) -> Result<String, String> {
    let key = normalize(&input.file)?;
    let base_version = snapshot::put(&input.source)?;
    let now = store::now_millis();

    store::update(|ledger: &mut Ledger| {
        record_version(ledger, &key, &base_version, Origin::Comment, None, now);
        let id = ledger.fresh_thread_id();
        ledger.threads.push(Thread {
            id: id.clone(),
            file: key.clone(),
            block_hash: snapshot::content_hash(&input.quote),
            quote: input.quote.clone(),
            selection: input.selection.clone(),
            selection_offset: input.selection_offset,
            section_path: input.section_path.clone(),
            base_version: base_version.clone(),
            status: Status::Open,
            comments: vec![Comment {
                id: store::new_id(),
                author: input.author.clone(),
                body: input.body.clone(),
                created_at: now,
            }],
            created_at: now,
            resolved: None,
        });
        Ok(id)
    })
}

pub fn reply(thread_id: &str, author: &str, body: &str) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        let thread = ledger
            .thread_mut(thread_id)
            .ok_or_else(|| format!("指摘 {thread_id} が見つかりません"))?;
        thread.comments.push(Comment {
            id: store::new_id(),
            author: author.to_string(),
            body: body.to_string(),
            created_at: store::now_millis(),
        });
        Ok(())
    })
}

pub fn resolve(thread_id: &str, by: &str) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        let thread = ledger
            .thread_mut(thread_id)
            .ok_or_else(|| format!("指摘 {thread_id} が見つかりません"))?;
        if matches!(thread.status, Status::Resolved { .. }) {
            return Err(format!("指摘 {thread_id} は既に解決済みです"));
        }
        thread.status = Status::Resolved {
            by: by.to_string(),
            at: store::now_millis(),
        };
        Ok(())
    })
}

// AI が「直した」を宣言する。現在のファイルの内容を版として記録する。
pub fn commit(file: &Path, message: &str) -> Result<String, String> {
    let key = normalize(file)?;
    let text = fs::read_to_string(&key).map_err(|e| format!("{key} を読めません: {e}"))?;
    let id = snapshot::put(&text)?;
    let now = store::now_millis();
    let label = message.to_string();
    store::update(|ledger: &mut Ledger| {
        record_version(ledger, &key, &id, Origin::Commit, Some(label.clone()), now);
        Ok(())
    })?;
    Ok(id)
}

// 同じ内容の版が既にあれば重ねて記録しない。ラベルは後から来た方を優先する。
fn record_version(
    ledger: &mut Ledger,
    file: &str,
    id: &str,
    origin: Origin,
    label: Option<String>,
    now: i64,
) {
    if let Some(existing) = ledger
        .versions
        .iter_mut()
        .find(|v| v.id == id && v.file == file)
    {
        if label.is_some() {
            existing.label = label;
            existing.origin = origin;
        }
        return;
    }
    ledger.versions.push(Version {
        id: id.to_string(),
        file: file.to_string(),
        label,
        origin,
        created_at: now,
    });
}

// ---- パス ----

// 指摘のキーは NFC 正規化した絶対パス。相対パスは実行時のカレントから解決する。
fn normalize(path: &Path) -> Result<String, String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("カレントディレクトリを取れません: {e}"))?
            .join(path)
    };
    let cleaned = fs::canonicalize(&abs).unwrap_or(abs);
    let text = cleaned
        .to_str()
        .ok_or_else(|| format!("パスを文字列にできません: {}", cleaned.display()))?;
    Ok(store::normalize_path(text))
}

fn under(file: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches('/');
    file.starts_with(dir) && file.as_bytes().get(dir.len()) == Some(&b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn under_matches_only_real_descendants() {
        assert!(under("/a/b/c.md", "/a/b"));
        assert!(under("/a/b/c.md", "/a/b/"));
        assert!(under("/a/b/d/c.md", "/a/b"));
        // 名前が途中まで一致するだけの別ディレクトリを拾わない
        assert!(!under("/a/bb/c.md", "/a/b"));
        assert!(!under("/a/b", "/a/b"));
        assert!(!under("/x/y.md", "/a/b"));
    }

    #[test]
    fn missing_file_reports_no_file() {
        let thread = Thread {
            id: "t".into(),
            file: "/tmp/mdglow-does-not-exist-9f3a.md".into(),
            quote: "なにか".into(),
            block_hash: "h".into(),
            selection: String::new(),
            selection_offset: 0,
            section_path: vec![],
            base_version: "v".into(),
            status: Status::Open,
            comments: vec![],
            created_at: 0,
            resolved: None,
        };
        assert_eq!(resolve_view(&thread).0, AnchorState::NoFile);
    }

    #[test]
    fn version_records_are_deduplicated_by_content() {
        let mut ledger = Ledger::default();
        record_version(&mut ledger, "/a.md", "hash1", Origin::Comment, None, 10);
        record_version(&mut ledger, "/a.md", "hash1", Origin::Comment, None, 20);
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].created_at, 10);

        // 同じ内容に後からラベルが付いたら上書きする
        record_version(
            &mut ledger,
            "/a.md",
            "hash1",
            Origin::Commit,
            Some("指摘1〜3に対応".into()),
            30,
        );
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].label.as_deref(), Some("指摘1〜3に対応"));
        assert_eq!(ledger.versions[0].origin, Origin::Commit);

        // 別ファイルの同一内容は別の版として持つ
        record_version(&mut ledger, "/b.md", "hash1", Origin::Comment, None, 40);
        assert_eq!(ledger.versions.len(), 2);
    }
}
