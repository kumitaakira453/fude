pub mod format;
pub mod locate;
pub mod snapshot;
pub mod store;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use locate::{Clues, LineMap, Located, Method};
use store::{Actor, ByteRange, Comment, Ledger, Origin, Status, Thread, Unit, Version};

// GUI（Tauri コマンド）と CLI が共通で呼ぶ操作層。
// Markdown の解析は一切しない。指摘を作るのは GUI だけで、ブロックの境界も
// 見出しの道筋も作成時に確定して台帳へ入っている。ここは記録された文字列が
// 今どこにあるかを locate に解かせ、結果を控え直すだけ。

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
    pub handled: Handled,
    pub anchor: AnchorState,
    pub head_quote: Option<String>, // 現在のブロック本文（控えから）
    pub cache_fresh: bool,          // 控えが今のファイルと合っているか
    // 今のファイルの中でどこか。解けなければ None（位置不明）。
    pub located: Option<locate::Located>,
    pub base: Option<Version>,      // 指摘した時点の版
    pub latest: Option<Version>,    // そのファイルの最新の版
}

// 「自分の返信」と見なす author の既定。CLI の reply もこの名前で書く。
pub const DEFAULT_AUTHOR: &str = "AI";

// 一覧の絞り込み。既定は「未対応」。解決を人間に委ねている以上、未解決には
// すでに返信したものが残り続けるので、未解決をそのまま次の仕事にはできない。
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum StatusFilter {
    #[default]
    Unanswered,
    Open,
    All,
}

impl StatusFilter {
    pub fn label(self) -> &'static str {
        match self {
            StatusFilter::Unanswered => "未対応",
            StatusFilter::Open => "未解決",
            StatusFilter::All => "すべて",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Filter {
    pub project: Option<PathBuf>,
    pub file: Option<PathBuf>,
    pub status: StatusFilter,
    // 「自分の返信」と見なす author。未対応の判定に使う。
    pub author: String,
}

impl Default for Filter {
    fn default() -> Self {
        Self {
            project: None,
            file: None,
            status: StatusFilter::default(),
            author: DEFAULT_AUTHOR.to_string(),
        }
    }
}

// 指摘の状態を、次に手を付けるべきかどうかで見る。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Handled {
    Unanswered, // まだ返していない、または人間が返信を重ねた
    Answered,   // 最後の発言が自分。人間の判断待ち
    Resolved,   // 人間が閉じた
}

// 最後の発言が自分なら返信済みと見なす。人間が再度書けば未対応に戻る。
// 解決済みの印を AI が付けない設計なので、この判定が「次の仕事」の唯一の目印になる。
pub fn handled_state(thread: &Thread, author: &str) -> Handled {
    if matches!(thread.status, Status::Resolved { .. }) {
        return Handled::Resolved;
    }
    match thread.comments.last() {
        Some(last) if last.author == author => Handled::Answered,
        _ => Handled::Unanswered,
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Counts {
    pub unanswered: usize,
    pub answered: usize,
    pub resolved: usize,
}

impl Counts {
    pub fn total(&self) -> usize {
        self.unanswered + self.answered + self.resolved
    }
}

// ---- 参照 ----

// 絞り込みの対象（project / file）を正規化した形で返す。
fn scope(filter: &Filter) -> Result<(Option<String>, Option<String>), String> {
    let project = filter
        .project
        .as_ref()
        .map(|p| normalize(p))
        .transpose()?;
    let file = filter.file.as_ref().map(|p| normalize(p)).transpose()?;
    Ok((project, file))
}

fn in_scope(thread: &Thread, project: &Option<String>, file: &Option<String>) -> bool {
    if let Some(f) = file {
        if &thread.file != f {
            return false;
        }
    }
    if let Some(dir) = project {
        if !under(&thread.file, dir) {
            return false;
        }
    }
    true
}

// 絞り込みの中の内訳を数える。status は無視するので、0 件のときに
// 「未対応が無いだけか、そもそも指摘が無いのか」を言い分けられる。
pub fn counts(filter: &Filter) -> Result<Counts, String> {
    let ledger = store::load()?;
    let (project, file) = scope(filter)?;
    let mut counts = Counts::default();
    for thread in &ledger.threads {
        if !in_scope(thread, &project, &file) {
            continue;
        }
        match handled_state(thread, &filter.author) {
            Handled::Unanswered => counts.unanswered += 1,
            Handled::Answered => counts.answered += 1,
            Handled::Resolved => counts.resolved += 1,
        }
    }
    Ok(counts)
}

// 一覧を出すのに何回働いたか。段ごとの費用が効いているかを外から見る。
#[derive(Debug, Default, Clone, Copy)]
pub struct Effort {
    // 対象ファイルを読んだ回数。指摘の数ではなくファイルの数に収まっているか。
    pub reads: usize,
    // 行差分を組んだ回数。書き換えられたファイルの数に収まっているか。
    pub diffs: usize,
}

pub fn list(filter: &Filter) -> Result<Vec<ThreadView>, String> {
    Ok(list_with(filter)?.0)
}

pub fn list_with(filter: &Filter) -> Result<(Vec<ThreadView>, Effort), String> {
    let ledger = store::load()?;
    let (project, file) = scope(filter)?;

    let mut desk = Desk::default();
    let mut views = Vec::new();
    for thread in &ledger.threads {
        let keep = match filter.status {
            StatusFilter::All => true,
            StatusFilter::Open => matches!(thread.status, Status::Open),
            StatusFilter::Unanswered => {
                handled_state(thread, &filter.author) == Handled::Unanswered
            }
        };
        if !keep {
            continue;
        }
        if !in_scope(thread, &project, &file) {
            continue;
        }
        let (anchor, head_quote, cache_fresh, located) = resolve_view(thread, &mut desk);
        views.push(ThreadView {
            handled: handled_state(thread, &filter.author),
            anchor,
            head_quote,
            cache_fresh,
            located,
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

    // 解いた結果を控え直す。基準が直近に寄るので、次の実行は L0 か L1 で止まる。
    // 台帳のロックは 1 回だけ取る。
    remember(&views)?;
    Ok((
        views,
        Effort {
            reads: desk.reads,
            diffs: desk.diffs,
        },
    ))
}

// 既に台帳にある指摘へ、位置の手掛かりを遡って埋める。
//
// 指摘した時点の本文は版として残っているので、そこから同じ手順で作れる。
// 版が残っていないものは空のままにして、前後の文脈による絞り込みだけを飛ばす。
#[derive(Debug, Default, Clone, Copy, serde::Serialize)]
pub struct Filled {
    pub filled: usize,
    pub skipped: usize,
    pub total: usize,
}

pub fn backfill(dry: bool) -> Result<Filled, String> {
    let ledger = store::load()?;
    let mut bases: HashMap<String, Option<String>> = HashMap::new();
    let mut want: Vec<(String, String, String, usize)> = Vec::new();
    let mut out = Filled {
        total: ledger.threads.len(),
        ..Default::default()
    };
    for thread in &ledger.threads {
        if thread.base_offset.is_some() {
            continue;
        }
        let base = bases
            .entry(thread.base_version.clone())
            .or_insert_with(|| snapshot::get(&thread.base_version).ok());
        let Some(base) = base.as_deref() else {
            out.skipped += 1;
            continue;
        };
        let Some(at) = locate::offset_of(base, &thread.quote) else {
            out.skipped += 1;
            continue;
        };
        let (prefix, suffix) = locate::context_of(base, at, thread.quote.len());
        want.push((thread.id.clone(), prefix, suffix, at));
    }
    out.filled = want.len();
    if dry || want.is_empty() {
        return Ok(out);
    }
    store::update(|ledger: &mut Ledger| {
        for (id, prefix, suffix, at) in &want {
            let Some(thread) = ledger.thread_mut(id) else {
                continue;
            };
            thread.prefix = prefix.clone();
            thread.suffix = suffix.clone();
            thread.base_offset = Some(*at);
        }
        Ok(())
    })?;
    Ok(out)
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

// 解くのに要るものを、ファイルごと・版ごとに 1 回だけ用意する台。
//
// 1 ファイルに指摘が 49 件付くことがある。件ごとに読み直すと同じ費用を
// 49 回払うことになる。
#[derive(Default)]
pub struct Desk {
    texts: HashMap<String, Option<String>>,
    bases: HashMap<String, Option<String>>,
    maps: HashMap<(String, String), Option<LineMap>>,
    // 実際に何回働いたか。試験で数えるために持つ。
    pub reads: usize,
    pub diffs: usize,
}

impl Desk {
    fn text(&mut self, file: &str) -> Option<&str> {
        if !self.texts.contains_key(file) {
            self.reads += 1;
            self.texts
                .insert(file.to_string(), fs::read_to_string(file).ok());
        }
        self.texts.get(file).and_then(|t| t.as_deref())
    }

    fn base(&mut self, version: &str) -> Option<&str> {
        if version.is_empty() {
            return None;
        }
        if !self.bases.contains_key(version) {
            self.bases
                .insert(version.to_string(), snapshot::get(version).ok());
        }
        self.bases.get(version).and_then(|t| t.as_deref())
    }

    // 版の控えは台帳の置き場から読む。試験では差し込む。
    #[cfg(test)]
    pub fn seed(&mut self, version: &str, text: &str) {
        self.bases.insert(version.to_string(), Some(text.to_string()));
    }

    // 基準版から今の本文への行の対応。同じ組は 1 回しか組まない。
    fn map(&mut self, version: &str, file: &str) -> Option<&LineMap> {
        let key = (version.to_string(), file.to_string());
        if !self.maps.contains_key(&key) {
            self.text(file);
            self.base(version);
            let made = match (
                self.bases.get(version).and_then(|t| t.as_deref()),
                self.texts.get(file).and_then(|t| t.as_deref()),
            ) {
                (Some(base), Some(text)) => Some(LineMap::build(base, text)),
                _ => None,
            };
            if made.is_some() {
                self.diffs += 1;
            }
            self.maps.insert(key.clone(), made);
        }
        self.maps.get(&key).and_then(|m| m.as_ref())
    }
}

// 指摘が今どうなっているかと、今どこにあるかを求める。
//
// 位置は locate が費用の安い順に解く。控えが当たればそこで止まり、探索も
// 差分も走らない。
fn resolve_view(
    thread: &Thread,
    desk: &mut Desk,
) -> (AnchorState, Option<String>, bool, Option<Located>) {
    desk.text(&thread.file);
    if desk
        .texts
        .get(&thread.file)
        .and_then(|t| t.as_ref())
        .is_none()
    {
        return (AnchorState::NoFile, None, false, None);
    }

    let head_quote = thread
        .resolved
        .as_ref()
        .map(|r| r.head_quote.as_str())
        .unwrap_or("");
    let cached = thread
        .resolved
        .as_ref()
        .and_then(|r| r.range)
        .map(|r| (r.start, r.end));
    let clues = |base, map| Clues {
        quote: &thread.quote,
        head_quote,
        prefix: &thread.prefix,
        suffix: &thread.suffix,
        base_offset: thread.base_offset,
        cached,
        base,
        map,
    };

    // まず安い段だけで試す。ここで決まれば、基準版を展開して行差分を組む
    // 費用を払わない。借用を切るために、本文を見るところを囲っておく。
    let quick = {
        let text = desk.texts[&thread.file].as_deref().unwrap();
        locate::cheap(text, &clues(None, None))
    };

    let located = match quick {
        Some(found) => Some(found),
        None => {
            desk.map(&thread.base_version, &thread.file);
            let text = desk.texts[&thread.file].as_deref().unwrap();
            let base = desk
                .bases
                .get(&thread.base_version)
                .and_then(|t| t.as_deref());
            let map = desk
                .maps
                .get(&(thread.base_version.clone(), thread.file.clone()))
                .and_then(|m| m.as_ref());
            locate::locate(text, &clues(base, map))
        }
    };

    let text = desk.texts[&thread.file].as_deref().unwrap();
    // 控えの本文がそのまま見つかったなら、控えは今のファイルと合っている。
    let fresh = matches!(
        located.as_ref().map(|l| l.method),
        Some(Method::Cache) | Some(Method::Exact) | Some(Method::Context)
    );
    let now = located
        .as_ref()
        .map(|l| text[l.start..l.end].to_string())
        .or_else(|| (!head_quote.is_empty()).then(|| head_quote.to_string()));

    // 状態は GUI が控えたものを優先する。GUI はブロックの対応付けで
    // 「消された」まで見分けられるが、こちらは字を探しているだけなので
    // 見分けられない。
    let state = match &thread.resolved {
        Some(resolved) => match resolved.state.as_str() {
            "unchanged" => AnchorState::Unchanged,
            "rewritten" => AnchorState::Rewritten,
            "removed" => AnchorState::Removed,
            _ => from_method(&located),
        },
        None => from_method(&located),
    };
    (state, now, fresh, located)
}

fn from_method(located: &Option<Located>) -> AnchorState {
    match located.as_ref().map(|l| l.method) {
        Some(Method::Cache) | Some(Method::Exact) | Some(Method::Context) => {
            AnchorState::Unchanged
        }
        Some(Method::Ported) | Some(Method::Fuzzy) => AnchorState::Rewritten,
        None => AnchorState::Unknown,
    }
}

// 解けた位置が控えと違っていれば書き戻す。次に読むときの出発点になる。
//
// 控える本文が長くなりすぎるときは範囲だけ残す。台帳は指摘が 9 割を占めるので、
// 移送が大きな区間を覆ったときにそこまで抱え込まない。
const KEEP_QUOTE: usize = 4096;

fn remember(views: &[ThreadView]) -> Result<(), String> {
    let mut ids: Vec<String> = Vec::new();
    let mut wanted: Vec<store::Resolved> = Vec::new();
    for view in views {
        let Some(found) = &view.located else { continue };
        // 1 つに決まっていないものは控えない。次も同じ迷い方をするのが正しい。
        if found.undecided() {
            continue;
        }
        let range = ByteRange {
            start: found.start,
            end: found.end,
            line_start: found.line_start,
            line_end: found.line_end,
        };
        let quote = view
            .head_quote
            .as_deref()
            .filter(|q| q.len() <= KEEP_QUOTE)
            .unwrap_or("")
            .to_string();
        let same = view.thread.resolved.as_ref().is_some_and(|r| {
            r.range == Some(range)
                && r.head_quote == quote
                && r.method.as_deref() == Some(found.method.tag())
        });
        if same {
            continue;
        }
        let state = match view.anchor {
            AnchorState::Unchanged => "unchanged",
            AnchorState::Rewritten => "rewritten",
            AnchorState::Removed => "removed",
            _ => "unknown",
        };
        wanted.push(store::Resolved {
            state: state.to_string(),
            head_quote: quote,
            at: 0,
            range: Some(range),
            method: Some(found.method.tag().to_string()),
            score: found.score,
        });
        ids.push(view.thread.id.clone());
    }
    if wanted.is_empty() {
        return Ok(());
    }
    let now = store::now_millis();
    store::update(|ledger: &mut Ledger| {
        for (id, resolved) in ids.iter().zip(wanted.iter()) {
            let Some(thread) = ledger.thread_mut(id) else {
                continue;
            };
            thread.resolved = Some(store::Resolved {
                at: now,
                ..resolved.clone()
            });
        }
        Ok(())
    })
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
        // 範囲は控え直す。GUI が見ている本文とディスクの中身は別物なので、
        // ここでは位置を決めず、次に読むときに解き直させる。
        thread.resolved = Some(store::Resolved {
            state: state.to_string(),
            head_quote: head_quote.to_string(),
            at: now,
            range: None,
            method: None,
            score: None,
        });
        Ok(())
    })
}

// ---- 更新 ----

// 人が明示的に打った版の結果。
#[derive(Debug, Clone, serde::Serialize)]
pub struct Checkpointed {
    pub id: String,
    // 同じ内容の版が既にあったときは false。押しても履歴が増えないことを
    // 画面の側で言えるようにする。
    pub created: bool,
}

// 復元の直前の本文に付ける名前。ここへ戻せば復元を取り消せる。
pub const BACKUP_LABEL: &str = "復元前";

// 復元の結果。
#[derive(Debug, Clone, serde::Serialize)]
pub struct Restored {
    // 書き戻した本文。
    pub text: String,
    // 復元の直前の本文の版。ここへ復元し直せば取り消せる。
    pub backup: String,
}

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
    // 項目・セルを丸ごと対象にしたとき、その引き先。
    pub unit: Option<Unit>,
}

pub fn create_thread(input: NewThread) -> Result<String, String> {
    let key = normalize(&input.file)?;
    let base_version = snapshot::put(&input.source)?;
    let now = store::now_millis();

    store::update(|ledger: &mut Ledger| {
        record_version(
            ledger,
            &key,
            &base_version,
            Origin::Comment,
            Actor::System,
            None,
            Vec::new(),
            now,
        );
        let id = ledger.fresh_thread_id();
        // 位置の手掛かりは、指摘した時点の本文から作る。ここで作っておけば、
        // あとから同じ文が増えても「どれを指していたか」が決まる。
        let at = locate::offset_of(&input.source, &input.quote);
        let (prefix, suffix) = match at {
            Some(at) => locate::context_of(&input.source, at, input.quote.len()),
            None => (String::new(), String::new()),
        };
        ledger.threads.push(Thread {
            id: id.clone(),
            file: key.clone(),
            block_hash: snapshot::content_hash(&input.quote),
            quote: input.quote.clone(),
            selection: input.selection.clone(),
            selection_offset: input.selection_offset,
            section_path: input.section_path.clone(),
            prefix,
            suffix,
            base_offset: at,
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
            unit: input.unit,
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

// 指摘そのものを取り消す。解決は「片付いた」記録が残るが、こちらは
// 「そもそも要らなかった」ときに使うので何も残さない。
pub fn remove(thread_id: &str) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        let before = ledger.threads.len();
        ledger.threads.retain(|t| t.id != thread_id);
        if ledger.threads.len() == before {
            return Err(format!("指摘 {thread_id} が見つかりません"));
        }
        Ok(())
    })
}

// 書き込みを書き直す。書いた時刻はそのまま残す。
pub fn edit_comment(thread_id: &str, comment_id: &str, body: &str) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        let thread = ledger
            .thread_mut(thread_id)
            .ok_or_else(|| format!("指摘 {thread_id} が見つかりません"))?;
        let comment = thread
            .comments
            .iter_mut()
            .find(|c| c.id == comment_id)
            .ok_or_else(|| format!("書き込み {comment_id} が見つかりません"))?;
        comment.body = body.to_string();
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

// 消した指摘をそのまま戻す。id も書き込みも時刻も元のままにするので、
// 戻したあとの印と会話が消す前と変わらない。
pub fn put_thread(thread: Thread) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        if ledger.thread(&thread.id).is_some() {
            return Err(format!("指摘 {} は既にあります", thread.id));
        }
        ledger.threads.push(thread);
        Ok(())
    })
}

// 解決を取り消して未解決に戻す。本文の上から解決にできるようにした分、
// 押し間違いをその場で戻せるようにしておく。
pub fn reopen(thread_id: &str) -> Result<(), String> {
    store::update(|ledger: &mut Ledger| {
        let thread = ledger
            .thread_mut(thread_id)
            .ok_or_else(|| format!("指摘 {thread_id} が見つかりません"))?;
        thread.status = Status::Open;
        Ok(())
    })
}

// 名前が変わったファイルの行を、新しいパスへ付け替える。
//
// 指摘も版も絶対パスで紐付いているので、付け替えないと名前を変えた時点で
// どちらも引けなくなる。版の控えは内容ハッシュで置いてあり実体は動かないので、
// 台帳の行だけを書き換える。フォルダごと動いたときは、その下の行も連れていく。
pub fn move_file(from: &Path, to: &Path) -> Result<usize, String> {
    let from = normalize(from)?;
    let to = normalize(to)?;
    if from == to {
        return Ok(0);
    }
    store::update(|ledger: &mut Ledger| Ok(apply_move(ledger, &from, &to)))
}

fn apply_move(ledger: &mut Ledger, from: &str, to: &str) -> usize {
    let mut moved = 0;
    for file in ledger
        .threads
        .iter_mut()
        .map(|t| &mut t.file)
        .chain(ledger.versions.iter_mut().map(|v| &mut v.file))
    {
        if let Some(next) = renamed(file, from, to) {
            *file = next;
            moved += 1;
        }
    }
    moved
}

// そのパスが from そのものか、from の下に居るなら、新しいパスを返す。
fn renamed(file: &str, from: &str, to: &str) -> Option<String> {
    if file == from {
        return Some(to.to_string());
    }
    under(file, from).then(|| format!("{to}{}", &file[from.trim_end_matches('/').len()..]))
}

// ---- 掃除 ----

// 掃除で何がどれだけ減るか。
#[derive(Debug, Default, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Swept {
    // 畳んだ版の行。
    pub folded: usize,
    // 捨てた控えのファイル。
    pub dropped: usize,
    // 圧縮し直した控えのファイル。
    pub squeezed: usize,
    // 減ったバイト数。
    pub freed: u64,
}

// 版の控えを片付ける。
//
// 控えは全文を内容ハッシュで置いていて、捨てる仕組みが無いまま増え続ける。
// ここで 3 つやる。どれも「読めるものを減らさない」ことを守る。
//
//   1. 連なった system の版のうち、どの指摘も基準にしていないものを畳む
//      （コメントを付けた時点の自動保存。人と AI が残した版は畳まない）
//   2. どの版も、どの指摘も指していない控えを捨てる
//   3. 素のまま置いてある控えを圧縮し直す（中身は変えない）
//
// dry なら数えるだけで、何も書き換えない。
pub fn sweep(dry: bool) -> Result<Swept, String> {
    let ledger = store::load()?;
    let folded = foldable(&ledger);
    let mut out = Swept {
        folded: folded.len(),
        ..Swept::default()
    };

    let mut alive: HashSet<String> = ledger
        .versions
        .iter()
        .map(|v| v.id.clone())
        .filter(|id| !folded.contains(id))
        .collect();
    for thread in &ledger.threads {
        alive.insert(thread.base_version.clone());
    }

    let dir = store::snapshots_dir()?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // まだ 1 つも控えが無い
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        let was = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if !alive.contains(&name) {
            out.dropped += 1;
            out.freed += was;
            if !dry {
                let _ = fs::remove_file(&path);
            }
            continue;
        }
        // 素のまま置いてあるものを圧縮し直す。中身（＝ID）は変わらない。
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if snapshot::is_squeezed(&bytes) {
            continue;
        }
        let text = snapshot::unsqueeze(&bytes)?;
        let packed = snapshot::squeeze(&text)?;
        if packed.len() >= bytes.len() {
            continue;
        }
        out.squeezed += 1;
        out.freed += was - packed.len() as u64;
        if !dry {
            store::write_atomic(&path, &packed)?;
        }
    }

    if !dry && !folded.is_empty() {
        store::update(|ledger: &mut Ledger| {
            ledger.versions.retain(|v| !folded.contains(&v.id));
            Ok(())
        })?;
    }
    Ok(out)
}

// 畳んでよい版。
//
// 畳むのは「コメントを付けた時点の自動保存（system）」が連なっているところ
// だけ。人が打った版と AI の対応の宣言は履歴として残す。どの指摘も基準に
// している版は、コメントした時点の差分を出せなくなるので残す。
// 連なりの最後は代表として残す。
fn foldable(ledger: &Ledger) -> HashSet<String> {
    let pinned: HashSet<&str> = ledger.threads.iter().map(|t| t.base_version.as_str()).collect();
    let mut by_file: HashMap<&str, Vec<&Version>> = HashMap::new();
    for v in &ledger.versions {
        by_file.entry(v.file.as_str()).or_default().push(v);
    }
    let mut out = HashSet::new();
    for rows in by_file.values_mut() {
        rows.sort_by_key(|v| v.created_at);
        for (i, v) in rows.iter().enumerate() {
            let next = rows.get(i + 1);
            let run = next.is_some_and(|n| n.who() == Actor::System);
            if v.who() == Actor::System && run && !pinned.contains(v.id.as_str()) {
                out.insert(v.id.clone());
            }
        }
    }
    out
}

// 指摘をまとめて解決にする。1 ファイル分を片付けるときに使う。
// 既に解決済みのものは飛ばし、解決にした件数を返す。
pub fn resolve_many(thread_ids: &[String], by: &str) -> Result<usize, String> {
    store::update(|ledger: &mut Ledger| {
        apply_resolve_many(ledger, thread_ids, by, store::now_millis())
    })
}

// 台帳への適用だけを取り出したもの。1 件でも見つからなければ何も書き換えない。
fn apply_resolve_many(
    ledger: &mut Ledger,
    thread_ids: &[String],
    by: &str,
    at: i64,
) -> Result<usize, String> {
    let missing: Vec<&str> = thread_ids
        .iter()
        .filter(|id| !ledger.threads.iter().any(|t| &t.id == *id))
        .map(String::as_str)
        .collect();
    if !missing.is_empty() {
        return Err(format!("指摘 {} が見つかりません", missing.join(", ")));
    }

    let mut done = 0;
    for id in thread_ids {
        let Some(thread) = ledger.thread_mut(id) else {
            continue;
        };
        if matches!(thread.status, Status::Resolved { .. }) {
            continue;
        }
        thread.status = Status::Resolved {
            by: by.to_string(),
            at,
        };
        done += 1;
    }
    Ok(done)
}

// AI が「直した」を宣言する。現在のファイルの内容を版として記録する。
//
// どの指摘への対応かを添えられる。添えてあると、読む側は「その対応で本文の
// どこが動いたか」を、指摘の箇所の外まで含めて出せる。
pub fn commit(file: &Path, message: &str, threads: &[String]) -> Result<String, String> {
    let key = normalize(file)?;
    let text = fs::read_to_string(&key).map_err(|e| format!("{key} を読めません: {e}"))?;
    let id = snapshot::put(&text)?;
    let now = store::now_millis();
    let label = message.to_string();
    store::update(|ledger: &mut Ledger| {
        record_version(
            ledger,
            &key,
            &id,
            Origin::Commit,
            Actor::Ai,
            Some(label.clone()),
            threads.to_vec(),
            now,
        );
        Ok(())
    })?;
    Ok(id)
}

// 人が明示的に版を打つ。画面に出ている本文をそのまま版にする。
//
// ディスクは読まない。指摘を付けるときと同じ扱いにすることで、ディスクの内容と
// ずれていても、版と画面に出ていたものが食い違わない。
pub fn checkpoint(
    file: &Path,
    text: &str,
    label: Option<String>,
    actor: Actor,
) -> Result<Checkpointed, String> {
    let key = normalize(file)?;
    let id = snapshot::put(text)?;
    let now = store::now_millis();
    store::update(|ledger: &mut Ledger| {
        let known = ledger.versions.iter().any(|v| v.id == id && v.file == key);
        record_version(
            ledger,
            &key,
            &id,
            Origin::Checkpoint,
            actor,
            label.clone(),
            Vec::new(),
            now,
        );
        Ok(Checkpointed {
            id: id.clone(),
            created: !known,
        })
    })
}

// ディスクの本文をそのまま版にする。CLI から使う（画面を持たないので、
// 「画面に出ていた本文」の代わりにディスクを読む）。
pub fn checkpoint_file(
    file: &Path,
    label: Option<String>,
    actor: Actor,
) -> Result<Checkpointed, String> {
    let key = normalize(file)?;
    let text = fs::read_to_string(&key).map_err(|e| format!("{key} を読めません: {e}"))?;
    checkpoint(file, &text, label, actor)
}

// 過去の版でファイルを置き換える。
//
// expect は画面が基準にしている本文。ディスクがそれと違えば外部で書き換わって
// いるので、何もせずに知らせる。復元前の本文は先に版として残すので、書き込みが
// 転んでも今の本文は失われない。
pub fn restore(file: &Path, version: &str, expect: &str) -> Result<Restored, String> {
    let key = normalize(file)?;
    let disk = fs::read_to_string(&key).map_err(|e| format!("{key} を読めません: {e}"))?;
    if disk != expect {
        return Err(
            "このファイルは fude の外で書き換わっています。読み直してからやり直してください。"
                .to_string(),
        );
    }
    // 戻す本文を先に取る。読めないなら、まだ何も書き換えていない。
    let target = snapshot::get(version)?;
    let backup = snapshot::put(&disk)?;
    let now = store::now_millis();
    store::update(|ledger: &mut Ledger| {
        apply_restore(ledger, &key, &backup, version, now);
        Ok(())
    })?;
    store::write_atomic(Path::new(&key), target.as_bytes())?;
    Ok(Restored {
        text: target,
        backup,
    })
}

// 復元を台帳に書く。復元前の本文と、戻した版の両方を残す。
//
// 復元そのものを新しい出来事として積むので、履歴は巻き戻さない。
fn apply_restore(ledger: &mut Ledger, file: &str, backup: &str, target: &str, now: i64) {
    let named = ledger.versions.iter().any(|v| v.id == backup && v.file == file);
    // 既に版になっている本文の名前は書き換えない。人が付けた名前を復元の
    // 都合で奪うことになる。
    let label = if named {
        None
    } else {
        Some(BACKUP_LABEL.to_string())
    };
    record_version(
        ledger,
        file,
        backup,
        Origin::Checkpoint,
        Actor::System,
        label,
        Vec::new(),
        now,
    );
    // 戻した版は台帳にあるので畳まれる。名前も主体も触らない。
    record_version(
        ledger,
        file,
        target,
        Origin::Checkpoint,
        Actor::System,
        None,
        Vec::new(),
        now,
    );
}

// 同じ内容の版が既にあれば重ねて記録しない。ラベルは後から来た方を優先する。
fn record_version(
    ledger: &mut Ledger,
    file: &str,
    id: &str,
    origin: Origin,
    actor: Actor,
    label: Option<String>,
    threads: Vec<String>,
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
            existing.actor = Some(actor);
        }
        // 同じ内容で打ち直したときは、指摘の紐付けだけを足す。
        for id in threads {
            if !existing.threads.contains(&id) {
                existing.threads.push(id);
            }
        }
        return;
    }
    ledger.versions.push(Version {
        id: id.to_string(),
        file: file.to_string(),
        label,
        origin,
        actor: Some(actor),
        threads,
created_at: now,
    });
}

// ---- パス ----

// 指摘のキーは NFC 正規化した絶対パス。相対パスは実行時のカレントから解決する。
//
// 名前が変わった後の「古い名前」のように、もう無いパスもキーにできる必要が
// ある。葉が解決できないときは親を解決して名前を継ぐ。素の絶対パスへ落とすと、
// symlink 越しに開いたファイルで台帳のキー（実体のパス）と食い違う。
fn normalize(path: &Path) -> Result<String, String> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("カレントディレクトリを取れません: {e}"))?
            .join(path)
    };
    let cleaned = fs::canonicalize(&abs).unwrap_or_else(|_| real_parent(&abs));
    let text = cleaned
        .to_str()
        .ok_or_else(|| format!("パスを文字列にできません: {}", cleaned.display()))?;
    Ok(store::normalize_path(text))
}

fn real_parent(abs: &Path) -> PathBuf {
    match (abs.parent(), abs.file_name()) {
        (Some(dir), Some(name)) => match fs::canonicalize(dir) {
            Ok(real) => real.join(name),
            Err(_) => abs.to_path_buf(),
        },
        _ => abs.to_path_buf(),
    }
}

fn under(file: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches('/');
    file.starts_with(dir) && file.as_bytes().get(dir.len()) == Some(&b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread_with(comments: Vec<(&str, &str)>) -> Thread {
        Thread {
            id: "t".into(),
            file: "/docs/a.md".into(),
            quote: "本文".into(),
            block_hash: "h".into(),
            selection: String::new(),
            selection_offset: 0,
            section_path: Vec::new(),
            prefix: String::new(),
            suffix: String::new(),
            base_offset: None,
            base_version: "v".into(),
            status: Status::Open,
            comments: comments
                .into_iter()
                .enumerate()
                .map(|(i, (author, body))| Comment {
                    id: format!("c{i}"),
                    author: author.into(),
                    body: body.into(),
                    created_at: 0,
                })
                .collect(),
            created_at: 0,
            resolved: None,
            unit: None,
        }
    }

    #[test]
    fn last_speaker_decides_whether_it_is_answered() {
        // 指摘だけ。まだ返していない
        assert_eq!(
            handled_state(&thread_with(vec![("you", "直して")]), "AI"),
            Handled::Unanswered
        );
        // 自分が返した。人間の判断待ち
        assert_eq!(
            handled_state(&thread_with(vec![("you", "直して"), ("AI", "直した")]), "AI"),
            Handled::Answered
        );
        // 人間が重ねて書いた。また自分の番
        assert_eq!(
            handled_state(
                &thread_with(vec![("you", "直して"), ("AI", "直した"), ("you", "まだ違う")]),
                "AI"
            ),
            Handled::Unanswered
        );
        // コメントが 1 つも無い指摘も未対応として拾う
        assert_eq!(handled_state(&thread_with(vec![]), "AI"), Handled::Unanswered);
    }

    #[test]
    fn resolved_outranks_the_last_speaker() {
        let mut thread = thread_with(vec![("you", "直して")]);
        thread.status = Status::Resolved {
            by: "you".into(),
            at: 0,
        };
        assert_eq!(handled_state(&thread, "AI"), Handled::Resolved);
    }

    #[test]
    fn the_author_treated_as_self_is_configurable() {
        let thread = thread_with(vec![("you", "直して"), ("AI", "直した")]);
        // 別の名前で見れば、AI の返信は他人の発言なので未対応のまま
        assert_eq!(handled_state(&thread, "bot"), Handled::Unanswered);
    }

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
            file: "/tmp/fude-does-not-exist-9f3a.md".into(),
            quote: "なにか".into(),
            block_hash: "h".into(),
            selection: String::new(),
            selection_offset: 0,
            section_path: vec![],
            prefix: String::new(),
            suffix: String::new(),
            base_offset: None,
            base_version: "v".into(),
            status: Status::Open,
            comments: vec![],
            created_at: 0,
            resolved: None,
            unit: None,
        };
        let mut desk = Desk::default();
        assert_eq!(resolve_view(&thread, &mut desk).0, AnchorState::NoFile);
    }

    fn thread_at(file: &str, quote: &str, base: &str) -> Thread {
        Thread {
            id: "t".into(),
            file: file.into(),
            quote: quote.into(),
            block_hash: "h".into(),
            selection: String::new(),
            selection_offset: 0,
            section_path: vec![],
            prefix: String::new(),
            suffix: String::new(),
            base_offset: None,
            base_version: base.into(),
            status: Status::Open,
            comments: vec![],
            created_at: 0,
            resolved: None,
            unit: None,
        }
    }

    #[test]
    fn one_file_is_read_once_however_many_threads_point_at_it() {
        let dir = std::env::temp_dir().join("fude-desk-read");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        fs::write(&file, "見出し\n\n対象の段落\n").unwrap();
        let path = file.to_string_lossy().into_owned();

        let mut desk = Desk::default();
        for _ in 0..49 {
            let thread = thread_at(&path, "対象の段落", "");
            let (_, _, _, found) = resolve_view(&thread, &mut desk);
            assert!(found.is_some());
        }
        // 指摘の数ではなくファイルの数だけ読む。
        assert_eq!(desk.reads, 1);
        fs::remove_file(&file).ok();
    }

    #[test]
    fn one_pair_is_diffed_once_however_many_threads_need_it() {
        let dir = std::env::temp_dir().join("fude-desk-diff");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("b.md");
        fs::write(&file, "見出し\n\n直された段落\n").unwrap();
        let path = file.to_string_lossy().into_owned();

        let mut desk = Desk::default();
        desk.seed("v1", "見出し\n\n元の段落\n");
        for _ in 0..49 {
            let thread = thread_at(&path, "元の段落", "v1");
            let (state, _, _, found) = resolve_view(&thread, &mut desk);
            assert_eq!(state, AnchorState::Rewritten);
            assert_eq!(found.unwrap().line_start, 3);
        }
        assert_eq!(desk.reads, 1);
        // 行差分は（基準版, ファイル）の組ごとに 1 回だけ。
        assert_eq!(desk.diffs, 1);
        fs::remove_file(&file).ok();
    }

    #[test]
    fn version_records_are_deduplicated_by_content() {
        let mut ledger = Ledger::default();
        record_version(&mut ledger, "/a.md", "hash1", Origin::Comment, Actor::System, None, Vec::new(), 10);
        record_version(&mut ledger, "/a.md", "hash1", Origin::Comment, Actor::System, None, Vec::new(), 20);
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].created_at, 10);

        // 同じ内容に後からラベルが付いたら上書きする
        record_version(
            &mut ledger,
            "/a.md",
            "hash1",
            Origin::Commit,
            Actor::Ai,
            Some("指摘1〜3に対応".into()),
            vec!["t1".into()],
            30,
        );
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].label.as_deref(), Some("指摘1〜3に対応"));
        assert_eq!(ledger.versions[0].origin, Origin::Commit);
        // 同じ内容で打ち直したときは、指摘の紐付けだけが足される
        assert_eq!(ledger.versions[0].threads, vec!["t1".to_string()]);
        assert_eq!(ledger.versions[0].who(), Actor::Ai);

        // 別ファイルの同一内容は別の版として持つ
        record_version(&mut ledger, "/b.md", "hash1", Origin::Comment, Actor::System, None, Vec::new(), 40);
        assert_eq!(ledger.versions.len(), 2);
    }

    #[test]
    fn a_version_punched_by_hand_is_a_checkpoint() {
        let mut ledger = Ledger::default();
        record_version(
            &mut ledger,
            "/a.md",
            "h1",
            Origin::Checkpoint,
            Actor::You,
            Some("初稿".into()),
            Vec::new(),
            10,
        );
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].origin, Origin::Checkpoint);
        assert_eq!(ledger.versions[0].label.as_deref(), Some("初稿"));
        assert_eq!(ledger.versions[0].who(), Actor::You);

        // 同じ本文をもう一度打っても増えず、打った時刻も動かない
        record_version(
            &mut ledger,
            "/a.md",
            "h1",
            Origin::Checkpoint,
            Actor::You,
            Some("初稿".into()),
            Vec::new(),
            20,
        );
        assert_eq!(ledger.versions.len(), 1);
        assert_eq!(ledger.versions[0].created_at, 10);
    }

    #[test]
    fn restoring_leaves_the_text_it_replaced_as_a_version() {
        let mut ledger = Ledger::default();
        record_version(
            &mut ledger,
            "/a.md",
            "old",
            Origin::Checkpoint,
            Actor::You,
            Some("初稿".into()),
            Vec::new(),
            10,
        );
        apply_restore(&mut ledger, "/a.md", "now", "old", 30);

        // 復元の直前の本文が版として残る。ここへ戻せば復元を取り消せる
        let backup = ledger.versions.iter().find(|v| v.id == "now").unwrap();
        assert_eq!(backup.label.as_deref(), Some(BACKUP_LABEL));
        assert_eq!(backup.origin, Origin::Checkpoint);
        // 復元は fude が自動で残すので、人の版とは区別する
        assert_eq!(backup.who(), Actor::System);
        assert_eq!(backup.created_at, 30);

        // 戻した版の名前と時刻はそのまま。履歴は巻き戻さない
        let target = ledger.versions.iter().find(|v| v.id == "old").unwrap();
        assert_eq!(target.label.as_deref(), Some("初稿"));
        assert_eq!(target.created_at, 10);
    }

    #[test]
    fn restoring_does_not_take_the_name_off_a_version_that_has_one() {
        // 打った版のまま復元すると、復元の直前の本文には既に名前が付いている
        let mut ledger = Ledger::default();
        record_version(
            &mut ledger,
            "/a.md",
            "now",
            Origin::Checkpoint,
            Actor::You,
            Some("下書き整理".into()),
            Vec::new(),
            10,
        );
        record_version(&mut ledger, "/a.md", "old", Origin::Comment, Actor::System, None, Vec::new(), 5);
        apply_restore(&mut ledger, "/a.md", "now", "old", 30);

        let kept = ledger.versions.iter().find(|v| v.id == "now").unwrap();
        assert_eq!(kept.label.as_deref(), Some("下書き整理"));
        // 名前と一緒に主体も奪わない
        assert_eq!(kept.who(), Actor::You);
        assert_eq!(ledger.versions.len(), 2);
    }
    fn open_thread(id: &str) -> Thread {
        Thread {
            id: id.into(),
            file: "/a.md".into(),
            quote: "なにか".into(),
            block_hash: "h".into(),
            selection: String::new(),
            selection_offset: 0,
            section_path: vec![],
            prefix: String::new(),
            suffix: String::new(),
            base_offset: None,
            base_version: "v".into(),
            status: Status::Open,
            comments: vec![],
            created_at: 0,
            resolved: None,
            unit: None,
        }
    }

    fn ledger_of(ids: &[&str]) -> Ledger {
        let mut ledger = Ledger::default();
        ledger.threads = ids.iter().map(|id| open_thread(id)).collect();
        ledger
    }

    fn is_resolved(ledger: &Ledger, id: &str) -> bool {
        ledger
            .threads
            .iter()
            .find(|t| t.id == id)
            .is_some_and(|t| matches!(t.status, Status::Resolved { .. }))
    }

    #[test]
    fn resolve_many_marks_every_open_thread() {
        let mut ledger = ledger_of(&["a", "b", "c"]);
        let ids = ["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(apply_resolve_many(&mut ledger, &ids, "you", 99), Ok(3));
        assert!(ids.iter().all(|id| is_resolved(&ledger, id)));
    }

    #[test]
    fn resolve_many_skips_already_resolved() {
        let mut ledger = ledger_of(&["a", "b", "c"]);
        ledger.threads[1].status = Status::Resolved {
            by: "AI".into(),
            at: 5,
        };
        let ids = ["a".to_string(), "b".to_string(), "c".to_string()];
        // 既に解決済みのものはエラーにせず飛ばし、数にも入れない
        assert_eq!(apply_resolve_many(&mut ledger, &ids, "you", 99), Ok(2));
        // 先に解決した記録は上書きしない
        assert!(matches!(
            &ledger.threads[1].status,
            Status::Resolved { by, at } if by == "AI" && *at == 5
        ));
    }

    #[test]
    fn resolve_many_leaves_the_ledger_untouched_when_an_id_is_missing() {
        let mut ledger = ledger_of(&["a", "b"]);
        let ids = ["a".to_string(), "gone".to_string()];
        assert!(apply_resolve_many(&mut ledger, &ids, "you", 99).is_err());
        assert!(ledger.threads.iter().all(|t| matches!(t.status, Status::Open)));
    }

    fn ledger_with(files: &[&str]) -> Ledger {
        let mut ledger = Ledger::default();
        for (i, file) in files.iter().enumerate() {
            let mut thread = thread_with(vec![]);
            thread.id = format!("t{i}");
            thread.file = (*file).into();
            ledger.threads.push(thread);
            ledger.versions.push(Version {
                id: format!("v{i}"),
                file: (*file).into(),
                label: None,
                origin: Origin::Comment,
                actor: None,
                threads: Vec::new(),
                created_at: 0,
            });
        }
        ledger
    }

    fn version_of(id: &str, file: &str, at: i64, origin: Origin, actor: Actor) -> Version {
        Version {
            id: id.into(),
            file: file.into(),
            label: None,
            origin,
            actor: Some(actor),
            threads: Vec::new(),
created_at: at,
        }
    }

    #[test]
    fn folding_keeps_what_people_and_agents_left() {
        let mut ledger = Ledger::default();
        ledger.versions = vec![
            version_of("s1", "/a.md", 1, Origin::Comment, Actor::System),
            version_of("s2", "/a.md", 2, Origin::Comment, Actor::System),
            version_of("s3", "/a.md", 3, Origin::Comment, Actor::System),
            version_of("ai", "/a.md", 4, Origin::Commit, Actor::Ai),
            version_of("you", "/a.md", 5, Origin::Checkpoint, Actor::You),
        ];
        // 連なった system のうち、最後（s3）は代表として残す
        let folded = foldable(&ledger);
        assert!(folded.contains("s1") && folded.contains("s2"));
        assert!(!folded.contains("s3"), "連なりの最後は残す");
        assert!(!folded.contains("ai") && !folded.contains("you"));
    }

    #[test]
    fn folding_keeps_versions_a_thread_stands_on() {
        let mut ledger = Ledger::default();
        ledger.versions = vec![
            version_of("s1", "/a.md", 1, Origin::Comment, Actor::System),
            version_of("s2", "/a.md", 2, Origin::Comment, Actor::System),
            version_of("s3", "/a.md", 3, Origin::Comment, Actor::System),
        ];
        let mut thread = thread_with(vec![]);
        thread.base_version = "s1".into();
        ledger.threads.push(thread);
        let folded = foldable(&ledger);
        assert!(!folded.contains("s1"), "指摘が基準にしている版は残す");
        assert!(folded.contains("s2"));
    }

    #[test]
    fn folding_does_not_reach_across_files() {
        let mut ledger = Ledger::default();
        ledger.versions = vec![
            version_of("a1", "/a.md", 1, Origin::Comment, Actor::System),
            version_of("b1", "/b.md", 2, Origin::Comment, Actor::System),
        ];
        // どちらもそのファイルでは 1 つきりなので畳まない
        assert!(foldable(&ledger).is_empty());
    }

    #[test]
    fn moving_a_file_takes_its_threads_and_versions() {
        let mut ledger = ledger_with(&["/docs/a.md", "/docs/b.md"]);
        assert_eq!(apply_move(&mut ledger, "/docs/a.md", "/docs/新しい.md"), 2);
        assert_eq!(ledger.threads[0].file, "/docs/新しい.md");
        assert_eq!(ledger.versions[0].file, "/docs/新しい.md");
        // 関係の無い行は動かない
        assert_eq!(ledger.threads[1].file, "/docs/b.md");
        assert_eq!(ledger.versions[1].file, "/docs/b.md");
    }

    #[test]
    fn moving_a_folder_takes_everything_under_it() {
        let mut ledger = ledger_with(&["/docs/設計/a.md", "/docs/設計案.md"]);
        assert_eq!(apply_move(&mut ledger, "/docs/設計", "/docs/仕様"), 2);
        assert_eq!(ledger.threads[0].file, "/docs/仕様/a.md");
        assert_eq!(ledger.versions[0].file, "/docs/仕様/a.md");
        // 名前が前方一致するだけの兄弟は巻き込まない
        assert_eq!(ledger.threads[1].file, "/docs/設計案.md");
    }

    #[test]
    fn the_key_survives_a_path_that_is_gone() {
        // 名前を変えた後の「古い名前」でもキーを作れる（親を辿る）
        let dir = std::env::temp_dir();
        let real = fs::canonicalize(&dir).expect("一時フォルダを解決できません");
        let gone = dir.join("fude-もう無いファイル.md");
        assert_eq!(
            normalize(&gone).expect("キーを作れません"),
            store::normalize_path(
                real.join("fude-もう無いファイル.md").to_str().expect("文字列にできません")
            )
        );
    }
}
