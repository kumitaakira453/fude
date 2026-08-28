use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;

// レビューの指摘と版の台帳。GUI と CLI が別プロセスから触るため、書き込みは
// ロックを取り、一時ファイルへ書いてから rename する。
// フロントエンドはこの JSON を plugin-fs で直接読む（読み取りに IPC を挟まない）。
//
// スレッドは絶対ファイルパスで持ち、台帳はプロジェクトごとに分けない。分けると
// ファイル名にするためのキー導出が必要になり、そこが壊れると過去の指摘が
// まとめて行方不明になる。プロジェクトでの絞り込みは接頭辞一致で足りる。
//
// このモジュールは tauri を参照しない。Tauri のビルドグラフ抜きで cargo test できる。

pub const FORMAT_VERSION: u32 = 1;

const LOCK_STALE: Duration = Duration::from_secs(30);
const LOCK_RETRY_LIMIT: u32 = 100;
const LOCK_RETRY_WAIT: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ledger {
    pub format_version: u32,
    #[serde(default)]
    pub threads: Vec<Thread>,
    #[serde(default)]
    pub versions: Vec<Version>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self {
            format_version: FORMAT_VERSION,
            threads: Vec::new(),
            versions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub file: String, // NFC 正規化した絶対パス
    // 指摘した時点のブロック本文（逐語）。位置が失われても引用として必ず出せる。
    pub quote: String,
    pub block_hash: String,
    #[serde(default)]
    pub selection: String, // 選択された表示テキスト
    #[serde(default)]
    pub selection_offset: usize, // ブロック内のプレーンテキスト上の位置
    #[serde(default)]
    pub section_path: Vec<String>,
    pub base_version: String, // 版 ID（本文の内容ハッシュ）
    pub status: Status,
    #[serde(default)]
    pub comments: Vec<Comment>,
    pub created_at: i64, // epoch ミリ秒
    // GUI が対応付けた結果の控え。CLI は Markdown を解析しないためこれを読む。
    #[serde(default)]
    pub resolved: Option<Resolved>,
}

// 指摘の対象が今の版でどうなっているか。GUI が基準版との対応付けで求めて書く。
//
// head_quote は解決した時点の「現在のブロック本文」。CLI はファイルを読めるので、
// この文字列が今のファイルに含まれるかで控えの新しさを自分で判定できる。
// 版のハッシュを別に持つ必要がない。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resolved {
    pub state: String, // unchanged | rewritten | removed | unknown
    #[serde(default)]
    pub head_quote: String,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Status {
    Open,
    Resolved { by: String, at: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: String, // 本文の内容ハッシュ。snapshots 配下のファイル名と同じ
    pub file: String,
    #[serde(default)]
    pub label: Option<String>,
    pub origin: Origin,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Comment,    // 指摘を付けた時点
    Commit,     // AI が対応を宣言した時点
    Checkpoint, // 人間が明示的に打った時点
}

impl Ledger {
    pub fn thread(&self, id: &str) -> Option<&Thread> {
        self.threads.iter().find(|t| t.id == id)
    }

    pub fn thread_mut(&mut self, id: &str) -> Option<&mut Thread> {
        self.threads.iter_mut().find(|t| t.id == id)
    }

    // 同じファイルの版を新しい順に返す。
    pub fn versions_of(&self, file: &str) -> Vec<&Version> {
        let mut v: Vec<&Version> = self.versions.iter().filter(|v| v.file == file).collect();
        v.sort_by_key(|v| std::cmp::Reverse(v.created_at));
        v
    }

    pub fn latest_version(&self, file: &str) -> Option<&Version> {
        self.versions_of(file).into_iter().next()
    }

    // 台帳内で衝突しない ID を採る。
    pub fn fresh_thread_id(&self) -> String {
        loop {
            let id = new_id();
            if self.thread(&id).is_none() {
                return id;
            }
        }
    }
}

// ---- 置き場所 ----

// CLI には AppHandle が無いので、パスは $HOME からの純粋な関数で決める。
pub fn review_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME が設定されていません")?;
    Ok(Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("com.mdglow.app")
        .join("review"))
}

pub fn ledger_path() -> Result<PathBuf, String> {
    Ok(review_dir()?.join("store.json"))
}

pub fn snapshots_dir() -> Result<PathBuf, String> {
    Ok(review_dir()?.join("snapshots"))
}

// ---- 読み書き ----

pub fn load() -> Result<Ledger, String> {
    load_from(&ledger_path()?)
}

pub fn load_from(path: &Path) -> Result<Ledger, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("台帳を読めません ({}): {e}", path.display())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Ledger::default()),
        Err(e) => Err(format!("台帳を読めません ({}): {e}", path.display())),
    }
}

// ロックを取って読み、変更を適用して書き戻す。GUI と CLI の同時更新で
// 片方の書き込みが消えるのを防ぐ。
pub fn update<T>(f: impl FnOnce(&mut Ledger) -> Result<T, String>) -> Result<T, String> {
    let dir = review_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let path = ledger_path()?;
    let _lock = Lock::acquire(&dir.join("store.json.lock"))?;
    let mut ledger = load_from(&path)?;
    let out = f(&mut ledger)?;
    ledger.format_version = FORMAT_VERSION;
    let bytes = serde_json::to_vec_pretty(&ledger).map_err(|e| e.to_string())?;
    write_atomic(&path, &bytes)?;
    Ok(out)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("{} に書けません: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("{} に置き換えられません: {e}", path.display()))
}

struct Lock {
    path: PathBuf,
}

impl Lock {
    fn acquire(path: &Path) -> Result<Self, String> {
        for _ in 0..LOCK_RETRY_LIMIT {
            match fs::OpenOptions::new().write(true).create_new(true).open(path) {
                Ok(_) => {
                    return Ok(Self {
                        path: path.to_path_buf(),
                    })
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    if stale(path) {
                        let _ = fs::remove_file(path);
                        continue;
                    }
                    std::thread::sleep(LOCK_RETRY_WAIT);
                }
                Err(e) => return Err(format!("ロックを取れません ({}): {e}", path.display())),
            }
        }
        Err("ロックが解放されません。mdglow を再起動してください".to_string())
    }
}

// 異常終了で取り残されたロックを一定時間で無効とみなす。
fn stale(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.elapsed().ok())
        .map(|age| age > LOCK_STALE)
        .unwrap_or(false)
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

// ---- 補助 ----

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// 表示にも使う短い ID。
pub fn new_id() -> String {
    let mut bytes = [0u8; 4];
    // /dev/urandom は終端の無いデバイスなので、必要な長さだけ読む。
    let filled = fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !filled {
        bytes = (now_millis() as u32).to_le_bytes();
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// macOS のファイル名は NFD で作られることがあり、そのままキーにすると同じファイルが
// 別物として扱われて指摘が 0 件になる。
pub fn normalize_path(path: &str) -> String {
    path.nfc().collect()
}

// epoch ミリ秒を UTC の ISO 8601 で表す。ローカル時刻への変換はタイムゾーン
// データベースを要するため、表示側（フロントエンド）に任せる。
pub fn format_iso_utc(millis: i64) -> String {
    let secs = millis.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

// 1970-01-01 からの日数を暦日に直す（Howard Hinnant の civil_from_days）。
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_thread() -> Thread {
        Thread {
            id: "a3f10000".into(),
            file: "/tmp/a.md".into(),
            quote: "生成AIの利用料金は、従来のSaaSと費用構造が異なる。".into(),
            block_hash: "deadbeef".into(),
            selection: "費用構造が異なる".into(),
            selection_offset: 12,
            section_path: vec!["背景".into(), "費用構造".into()],
            base_version: "cafe".into(),
            status: Status::Open,
            comments: vec![Comment {
                id: "c1".into(),
                author: "汲田 晶".into(),
                body: "「根本的に」を入れて".into(),
                created_at: 1,
            }],
            created_at: 1,
            resolved: None,
        }
    }

    #[test]
    fn default_ledger_is_empty() {
        let l = Ledger::default();
        assert_eq!(l.format_version, FORMAT_VERSION);
        assert!(l.threads.is_empty());
        assert!(l.versions.is_empty());
    }

    #[test]
    fn ledger_round_trips() {
        let mut l = Ledger::default();
        l.threads.push(sample_thread());
        let json = serde_json::to_string(&l).unwrap();
        let back: Ledger = serde_json::from_str(&json).unwrap();
        assert_eq!(back.threads.len(), 1);
        assert_eq!(back.threads[0].section_path, vec!["背景", "費用構造"]);
        assert_eq!(back.threads[0].status, Status::Open);
        assert_eq!(back.threads[0].comments[0].author, "汲田 晶");
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        // 台帳にフィールドを足しても過去のファイルが読めること
        let json = r#"{"format_version":1,"threads":[{
            "id":"x","file":"/tmp/a.md","quote":"q","block_hash":"h",
            "base_version":"v","status":{"kind":"open"},"created_at":0
        }]}"#;
        let l: Ledger = serde_json::from_str(json).unwrap();
        assert_eq!(l.threads[0].selection, "");
        assert_eq!(l.threads[0].selection_offset, 0);
        assert!(l.threads[0].section_path.is_empty());
        assert!(l.threads[0].comments.is_empty());
        assert!(l.versions.is_empty());
    }

    #[test]
    fn resolved_status_round_trips() {
        let s = Status::Resolved {
            by: "汲田 晶".into(),
            at: 42,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(serde_json::from_str::<Status>(&json).unwrap(), s);
    }

    #[test]
    fn versions_are_newest_first() {
        let mut l = Ledger::default();
        for (id, at) in [("v1", 100), ("v2", 300), ("v3", 200)] {
            l.versions.push(Version {
                id: id.into(),
                file: "/tmp/a.md".into(),
                label: None,
                origin: Origin::Commit,
                created_at: at,
            });
        }
        l.versions.push(Version {
            id: "other".into(),
            file: "/tmp/b.md".into(),
            label: None,
            origin: Origin::Commit,
            created_at: 999,
        });
        let ids: Vec<&str> = l
            .versions_of("/tmp/a.md")
            .iter()
            .map(|v| v.id.as_str())
            .collect();
        assert_eq!(ids, vec!["v2", "v3", "v1"]);
        assert_eq!(l.latest_version("/tmp/a.md").unwrap().id, "v2");
        assert!(l.latest_version("/tmp/missing.md").is_none());
    }

    #[test]
    fn new_id_is_eight_hex_digits() {
        let id = new_id();
        assert_eq!(id.len(), 8);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        // 呼ぶたびに戻ってくること（無限デバイスを読み切ろうとしない）
        assert_eq!(new_id().len(), 8);
    }

    #[test]
    fn decomposed_filenames_are_composed() {
        // NFD で作られたファイル名（"が" が "か" + U+3099）
        assert_eq!(normalize_path("か\u{3099}ぞう.md"), "がぞう.md");
        assert_eq!(normalize_path("ホ\u{309A}ート.md"), "ポート.md");
        assert_eq!(normalize_path("画像.md"), "画像.md");
        // 合成できない組み合わせは落とさずそのまま残す
        assert_eq!(normalize_path("あ\u{3099}"), "あ\u{3099}");
    }

    #[test]
    fn iso_utc_formats_known_instants() {
        assert_eq!(format_iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_iso_utc(1_000), "1970-01-01T00:00:01Z");
        // 2026-02-27T09:10:00Z
        assert_eq!(format_iso_utc(1_772_183_400_000), "2026-02-27T09:10:00Z");
        // 閏日
        assert_eq!(format_iso_utc(1_583_020_800_000), "2020-03-01T00:00:00Z");
    }
}
