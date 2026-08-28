use super::store::{format_iso_utc, Status, Version};
use super::{AnchorState, ThreadView};

// CLI の既定出力。読み手は AI なので、JSON より読みやすく字数も少ない Markdown にする。
//
// どの状態でも「指摘した時点の本文」を必ず添える。これがあれば、本文が
// 書き換わって位置が特定できなくなっても対象を見失わない。
// 書き換わっている場合は、対応付けで求めた「現在の本文」も添える。

pub fn threads_markdown(views: &[ThreadView]) -> String {
    if views.is_empty() {
        return "未解決の指摘はありません。".to_string();
    }

    let mut out = String::new();
    let mut current_file: Option<&str> = None;

    for view in views {
        if current_file != Some(view.thread.file.as_str()) {
            current_file = Some(view.thread.file.as_str());
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("## {}\n", view.thread.file));
        }
        out.push_str(&thread_section(view));
    }
    out
}

fn thread_section(view: &ThreadView) -> String {
    let t = &view.thread;
    let mut s = String::new();

    s.push_str(&format!("\n### 指摘 #{}", t.id));
    s.push_str(&format!(" — {}", anchor_label(view.anchor)));
    if let Status::Resolved { ref by, at } = t.status {
        s.push_str(&format!(" — 解決済み（{by} / {}）", format_iso_utc(at)));
    }
    s.push('\n');

    s.push_str(&format!("場所: {}\n", section_label(&t.section_path)));
    s.push_str(&format!(
        "版: 指摘時 {} / 現在 {}\n",
        version_label(view.base.as_ref(), &t.base_version),
        view.latest
            .as_ref()
            .map(|v| version_label(Some(v), &v.id))
            .unwrap_or_else(|| "記録なし".to_string()),
    ));

    if !t.selection.is_empty() && t.selection != t.quote {
        s.push_str(&format!("\n選択された箇所:\n{}\n", quote_block(&t.selection)));
    }
    s.push_str(&format!("\n指摘時の本文:\n{}\n", quote_block(&t.quote)));

    // 書き換わっているときだけ現在の本文を添える。変わっていなければ
    // 指摘時の本文と同じで、二度出す意味がない。
    if view.anchor == AnchorState::Rewritten {
        if let Some(ref head) = view.head_quote {
            s.push_str(&format!("\n現在の本文:\n{}\n", quote_block(head)));
        }
    }
    if !view.cache_fresh && view.head_quote.is_some() {
        s.push_str(
            "\n注: この対応付けは mdglow が最後にこのファイルを開いた時点のものです。\
             その後ファイルが変わっています。\n",
        );
    }

    if !t.comments.is_empty() {
        s.push_str("\n会話:\n");
        for c in &t.comments {
            // 本文の改行は箇条書きの継続行として畳む
            let body = c.body.replace('\n', "\n  ");
            s.push_str(&format!("- {}: {}\n", c.author, body));
        }
    }
    s
}

fn anchor_label(state: AnchorState) -> &'static str {
    match state {
        AnchorState::Unchanged => "対象はまだ書き換わっていません",
        AnchorState::Rewritten => "対象は指摘のあと書き換わっています",
        AnchorState::Removed => "対象は削除されています",
        AnchorState::Unknown => "対象の位置を特定できていません",
        AnchorState::NoFile => "ファイルが見つかりません",
    }
}

fn section_label(path: &[String]) -> String {
    if path.is_empty() {
        return "(ファイル先頭)".to_string();
    }
    path.join(" › ")
}

// 版は内容ハッシュなので、表示は先頭 8 桁に切って時刻を添える。
fn version_label(version: Option<&Version>, id: &str) -> String {
    let short: String = id.chars().take(8).collect();
    match version {
        Some(v) => {
            let when = format_iso_utc(v.created_at);
            match v.label {
                Some(ref label) => format!("{short} ({when} \"{label}\")"),
                None => format!("{short} ({when})"),
            }
        }
        None => format!("{short} (記録なし)"),
    }
}

fn quote_block(text: &str) -> String {
    text.lines()
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::super::store::{Comment, Origin, Thread};
    use super::*;

    const QUOTE: &str = "生成AIの利用料金は、従来のSaaSと費用構造が異なる。";
    const HEAD: &str = "生成AIの利用料金は、従来のSaaSと費用構造が根本的に異なり、従量課金である。";

    fn view(anchor: AnchorState) -> ThreadView {
        ThreadView {
            thread: Thread {
                id: "a3f10000".into(),
                file: "/docs/05_要件定義書.md".into(),
                quote: QUOTE.into(),
                block_hash: "h".into(),
                selection: "費用構造が異なる".into(),
                selection_offset: 12,
                section_path: vec!["背景".into(), "費用構造".into()],
                base_version: "aaaaaaaabbbb".into(),
                status: Status::Open,
                comments: vec![Comment {
                    id: "c1".into(),
                    author: "you".into(),
                    body: "「根本的に」を入れて".into(),
                    created_at: 1_772_183_400_000,
                }],
                created_at: 1_772_183_400_000,
                resolved: None,
            },
            anchor,
            head_quote: Some(HEAD.into()),
            cache_fresh: true,
            base: Some(Version {
                id: "aaaaaaaabbbb".into(),
                file: "/docs/05_要件定義書.md".into(),
                label: None,
                origin: Origin::Comment,
                created_at: 1_772_183_400_000,
            }),
            latest: Some(Version {
                id: "ccccccccdddd".into(),
                file: "/docs/05_要件定義書.md".into(),
                label: Some("指摘1〜3に対応".into()),
                origin: Origin::Commit,
                created_at: 1_772_190_000_000,
            }),
        }
    }

    const ALL_STATES: [AnchorState; 5] = [
        AnchorState::Unchanged,
        AnchorState::Rewritten,
        AnchorState::Removed,
        AnchorState::Unknown,
        AnchorState::NoFile,
    ];

    #[test]
    fn empty_input_says_so() {
        assert_eq!(threads_markdown(&[]), "未解決の指摘はありません。");
    }

    #[test]
    fn quote_is_always_included() {
        for anchor in ALL_STATES {
            let md = threads_markdown(&[view(anchor)]);
            assert!(
                md.contains(&format!("> {QUOTE}")),
                "{anchor:?} で指摘時の本文が落ちた"
            );
            assert!(md.contains("指摘時の本文:"), "{anchor:?}");
        }
    }

    #[test]
    fn every_state_is_labelled() {
        for anchor in ALL_STATES {
            let md = threads_markdown(&[view(anchor)]);
            assert!(
                md.contains(&format!("### 指摘 #a3f10000 — {}", anchor_label(anchor))),
                "{anchor:?} のラベルが出ていない"
            );
        }
    }

    #[test]
    fn current_text_is_shown_only_when_rewritten() {
        // 書き換わっているときは、対応付けで求めた現在の本文を添える
        let rewritten = threads_markdown(&[view(AnchorState::Rewritten)]);
        assert!(rewritten.contains("現在の本文:"));
        assert!(rewritten.contains(&format!("> {HEAD}")));

        // 変わっていなければ指摘時の本文と同じなので二度出さない
        for anchor in [AnchorState::Unchanged, AnchorState::Removed, AnchorState::Unknown] {
            assert!(
                !threads_markdown(&[view(anchor)]).contains("現在の本文:"),
                "{anchor:?} で現在の本文を余計に出している"
            );
        }
    }

    #[test]
    fn stale_cache_is_disclosed() {
        let mut v = view(AnchorState::Rewritten);
        v.cache_fresh = false;
        let md = threads_markdown(&[v]);
        assert!(md.contains("その後ファイルが変わっています"));

        assert!(!threads_markdown(&[view(AnchorState::Rewritten)])
            .contains("その後ファイルが変わっています"));
    }

    #[test]
    fn header_carries_section_path_and_versions() {
        let md = threads_markdown(&[view(AnchorState::Unchanged)]);
        assert!(md.contains("## /docs/05_要件定義書.md"));
        assert!(md.contains("場所: 背景 › 費用構造"));
        assert!(md.contains("指摘時 aaaaaaaa (2026-02-27T09:10:00Z)"));
        assert!(md.contains("現在 cccccccc (2026-02-27T11:00:00Z \"指摘1〜3に対応\")"));
    }

    #[test]
    fn file_heading_is_written_once_per_file() {
        let md = threads_markdown(&[
            view(AnchorState::Unchanged),
            view(AnchorState::Rewritten),
        ]);
        assert_eq!(md.matches("## /docs/05_要件定義書.md").count(), 1);
        assert_eq!(md.matches("### 指摘 #").count(), 2);
    }

    #[test]
    fn section_path_falls_back_for_top_of_file() {
        let mut v = view(AnchorState::Unchanged);
        v.thread.section_path.clear();
        assert!(threads_markdown(&[v]).contains("場所: (ファイル先頭)"));
    }

    #[test]
    fn selection_is_omitted_when_it_equals_the_quote() {
        let mut v = view(AnchorState::Unchanged);
        v.thread.selection = v.thread.quote.clone();
        assert!(!threads_markdown(&[v]).contains("選択された箇所:"));
    }

    #[test]
    fn multiline_quote_is_prefixed_per_line() {
        let mut v = view(AnchorState::Unchanged);
        v.thread.quote = "| 定数名 | 値 |\n| --- | --- |\n| EMAIL | email |".into();
        let md = threads_markdown(&[v]);
        assert!(md.contains("> | 定数名 | 値 |"));
        assert!(md.contains("> | EMAIL | email |"));
    }

    #[test]
    fn resolved_threads_show_who_and_when() {
        let mut v = view(AnchorState::Unchanged);
        v.thread.status = Status::Resolved {
            by: "you".into(),
            at: 1_772_190_000_000,
        };
        let md = threads_markdown(&[v]);
        assert!(md.contains("解決済み（you / 2026-02-27T11:00:00Z）"));
    }
}
