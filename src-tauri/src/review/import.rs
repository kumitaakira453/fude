use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

use super::store::{self, Comment, Ledger, Origin, Status, Thread, Version};
use super::{snapshot, Filter};

// Remarker（先行して使っていた別アプリ）の指摘を取り込む。
//
// Remarker はブロック本文を持たず選択テキストだけを記録しているため、
// quote には選択テキストを入れる。本文が書き換わって照合できない指摘も
// 引用として必ず表示できる状態にすることが目的で、位置の復元は狙わない。
//
// 版は Remarker の file_snapshots（ファイルごとの前回内容）を使う。
// これで取り込んだ指摘にも基準版が付く。

#[derive(Debug, Deserialize)]
struct RemarkerStore {
    #[serde(default)]
    threads: Vec<RemarkerThread>,
    #[serde(default)]
    file_snapshots: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct RemarkerThread {
    id: String,
    file_path: String,
    #[serde(default)]
    section_path: Vec<String>,
    #[serde(default)]
    selected_text: String,
    status: RemarkerStatus,
    #[serde(default)]
    comments: Vec<RemarkerComment>,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum RemarkerStatus {
    Open,
    Outdated,
    Resolved {
        resolved_by: String,
        resolved_at: String,
    },
}

#[derive(Debug, Deserialize)]
struct RemarkerComment {
    author: String,
    body: String,
    created_at: String,
}

#[derive(Debug, Default, PartialEq)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize, // 既に取り込み済み
    pub files: usize,
}

pub fn remarker_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME が設定されていません")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("remarker")
        .join("comments"))
}

pub fn import_remarker() -> Result<ImportReport, String> {
    let dir = remarker_dir()?;
    if !dir.exists() {
        return Err(format!("Remarker の保存先が見つかりません: {}", dir.display()));
    }

    let mut stores = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("{} を読めません: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|e| format!("{} を読めません: {e}", path.display()))?;
        let parsed: RemarkerStore = serde_json::from_str(&text)
            .map_err(|e| format!("{} を解釈できません: {e}", path.display()))?;
        stores.push(parsed);
    }

    // 版の本文はロックの外で先に保存する。内容アドレスなので何度書いても同じ。
    let mut base_versions = std::collections::HashMap::new();
    for store_data in &stores {
        for (file, text) in &store_data.file_snapshots {
            let key = store::normalize_path(file);
            let id = snapshot::put(text)?;
            base_versions.insert(key, id);
        }
    }

    let now = store::now_millis();
    store::update(|ledger: &mut Ledger| {
        let mut report = ImportReport::default();
        let mut seen_files = std::collections::HashSet::new();

        for store_data in &stores {
            for source in &store_data.threads {
                let id = short_id(&source.id);
                if ledger.thread(&id).is_some() {
                    report.skipped += 1;
                    continue;
                }
                let file = store::normalize_path(&source.file_path);
                let base_version = base_versions.get(&file).cloned().unwrap_or_default();
                if !base_version.is_empty()
                    && !ledger
                        .versions
                        .iter()
                        .any(|v| v.id == base_version && v.file == file)
                {
                    ledger.versions.push(Version {
                        id: base_version.clone(),
                        file: file.clone(),
                        label: Some("Remarker から取り込み".to_string()),
                        origin: Origin::Comment,
                        created_at: parse_rfc3339_millis(&source.created_at).unwrap_or(now),
                    });
                }

                seen_files.insert(file.clone());
                ledger.threads.push(Thread {
                    id,
                    block_hash: snapshot::content_hash(&source.selected_text),
                    quote: source.selected_text.clone(),
                    selection: source.selected_text.clone(),
                    selection_offset: 0,
                    section_path: source.section_path.clone(),
                    base_version,
                    status: convert_status(&source.status, now),
                    comments: source
                        .comments
                        .iter()
                        .map(|c| Comment {
                            id: store::new_id(),
                            author: c.author.clone(),
                            body: c.body.clone(),
                            created_at: parse_rfc3339_millis(&c.created_at).unwrap_or(now),
                        })
                        .collect(),
                    created_at: parse_rfc3339_millis(&source.created_at).unwrap_or(now),
                    file,
                });
                report.imported += 1;
            }
        }
        report.files = seen_files.len();
        Ok(report)
    })
}

// Remarker の Outdated は「対象が書き換わった」という別の軸の情報なので、
// 指摘の状態としては未解決に寄せる。書き換わったかどうかは現在の本文と
// 照合して判定するため、取り込み時に固定しない。
fn convert_status(status: &RemarkerStatus, fallback: i64) -> Status {
    match status {
        RemarkerStatus::Open | RemarkerStatus::Outdated => Status::Open,
        RemarkerStatus::Resolved {
            resolved_by,
            resolved_at,
        } => Status::Resolved {
            by: resolved_by.clone(),
            at: parse_rfc3339_millis(resolved_at).unwrap_or(fallback),
        },
    }
}

// Remarker の ID（UUID）の先頭 8 桁を使う。取り込みを繰り返しても
// 同じ ID になるので二重に入らない。
fn short_id(uuid: &str) -> String {
    uuid.chars()
        .filter(|c| c.is_ascii_hexdigit())
        .take(8)
        .collect::<String>()
        .to_lowercase()
}

// 取り込み元の時刻は RFC 3339 の文字列。必要なのは epoch ミリ秒だけなので、
// 日付と時刻を取り出して変換する。解釈できなければ None を返す。
fn parse_rfc3339_millis(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |from: usize, len: usize| -> Option<i64> {
        text.get(from..from + len)?.parse::<i64>().ok()
    };
    let (y, mo, d) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (h, mi, s) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }

    let mut millis = (days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + s) * 1_000;

    let rest = &text[19..];
    let rest = if let Some(frac) = rest.strip_prefix('.') {
        let digits: String = frac.chars().take_while(|c| c.is_ascii_digit()).collect();
        let mut sub = digits.chars().take(3).collect::<String>();
        while sub.len() < 3 {
            sub.push('0');
        }
        millis += sub.parse::<i64>().unwrap_or(0);
        &frac[digits.len()..]
    } else {
        rest
    };

    // オフセット付きなら UTC に寄せる
    if let Some(sign) = rest.chars().next() {
        if sign == '+' || sign == '-' {
            let oh = rest.get(1..3)?.parse::<i64>().ok()?;
            let om = rest.get(4..6).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
            let delta = (oh * 60 + om) * 60 * 1_000;
            millis += if sign == '+' { -delta } else { delta };
        }
    }
    Some(millis)
}

// 暦日を 1970-01-01 からの日数に直す（Howard Hinnant の days_from_civil）。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

// 取り込み結果を人が読める形にする。
pub fn describe(report: &ImportReport) -> Result<String, String> {
    let views = super::list(&Filter {
        include_resolved: true,
        ..Default::default()
    })?;
    let mut ok = 0;
    let mut stale = 0;
    let mut no_file = 0;
    for v in &views {
        match v.anchor {
            super::AnchorState::Ok => ok += 1,
            super::AnchorState::Stale => stale += 1,
            super::AnchorState::NoFile => no_file += 1,
        }
    }
    Ok(format!(
        "取り込み {} 件 / 既存 {} 件 / 対象ファイル {} 件\n\
         台帳の指摘 {} 件: 対象が残っている {} / 書き換わった {} / ファイルなし {}",
        report.imported,
        report.skipped,
        report.files,
        views.len(),
        ok,
        stale,
        no_file
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_id_is_stable_and_hex() {
        let id = short_id("6A587318-A81F-AF91-0000-000000000000");
        assert_eq!(id, "6a587318");
        assert_eq!(id, short_id("6A587318-A81F-AF91-0000-000000000000"));
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn days_from_civil_is_inverse_of_civil_from_days() {
        // 1970 の元日と、閏日を含む日付で往復すること
        for (y, m, d) in [(1970, 1, 1), (2020, 2, 29), (2026, 2, 27), (1999, 12, 31)] {
            let days = days_from_civil(y, m, d);
            let iso = store::format_iso_utc(days * 86_400_000);
            assert_eq!(iso, format!("{y:04}-{m:02}-{d:02}T00:00:00Z"));
        }
    }

    #[test]
    fn rfc3339_is_parsed() {
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_millis("2026-02-27T09:10:00Z"),
            Some(1_772_183_400_000)
        );
        // 小数秒は 3 桁に丸める
        assert_eq!(
            parse_rfc3339_millis("2026-02-27T09:10:00.250Z"),
            Some(1_772_183_400_250)
        );
        assert_eq!(
            parse_rfc3339_millis("2026-02-27T09:10:00.123456789Z"),
            Some(1_772_183_400_123)
        );
        // オフセット付きは UTC に寄せる
        assert_eq!(
            parse_rfc3339_millis("2026-02-27T18:10:00+09:00"),
            Some(1_772_183_400_000)
        );
    }

    #[test]
    fn malformed_timestamps_return_none() {
        assert_eq!(parse_rfc3339_millis(""), None);
        assert_eq!(parse_rfc3339_millis("2026-02-27"), None);
        assert_eq!(parse_rfc3339_millis("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_millis("2026-02-00T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_millis("XXXX-02-27T09:10:00Z"), None);
    }

    #[test]
    fn outdated_becomes_open() {
        // Outdated は「対象が書き換わった」という別軸の情報なので状態には持ち込まない
        assert_eq!(convert_status(&RemarkerStatus::Outdated, 0), Status::Open);
        assert_eq!(convert_status(&RemarkerStatus::Open, 0), Status::Open);
        assert_eq!(
            convert_status(
                &RemarkerStatus::Resolved {
                    resolved_by: "user".into(),
                    resolved_at: "2026-02-27T09:10:00Z".into(),
                },
                0
            ),
            Status::Resolved {
                by: "user".into(),
                at: 1_772_183_400_000
            }
        );
    }

    #[test]
    fn remarker_store_shape_is_accepted() {
        let json = r#"{
          "project_path": "/docs",
          "threads": [{
            "id": "6a587318-a81f-af91-0000-000000000000",
            "file_path": "/docs/05.md",
            "line_number": 12,
            "section_path": [],
            "selected_text": "費用構造が異なる",
            "status": {"type": "Outdated"},
            "comments": [{"id":"c","author":"user","body":"直して","created_at":"2026-02-27T09:10:00Z"}],
            "created_at": "2026-02-27T09:00:00Z"
          }],
          "file_snapshots": {"/docs/05.md": "むかしの本文"}
        }"#;
        let parsed: RemarkerStore = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.threads.len(), 1);
        assert_eq!(parsed.threads[0].selected_text, "費用構造が異なる");
        assert_eq!(parsed.file_snapshots.len(), 1);
    }
}
