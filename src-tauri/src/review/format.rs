use super::store::{format_iso_utc, Status, Version};
use super::{AnchorState, ThreadView};

// CLI の既定出力。読み手は AI なので、JSON より読みやすく字数も少ない Markdown にする。
//
// どのアンカー状態でも「指摘した時点の本文」を必ず添える。これがあれば、
// 本文が書き換わって位置が特定できなくなっても対象を見失わない。

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
    if let Some(label) = anchor_label(view.anchor) {
        s.push_str(&format!(" — {label}"));
    }
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

fn anchor_label(state: AnchorState) -> Option<&'static str> {
    match state {
        // 対象がそのまま残っているのは既定なので、あえて書かない
        AnchorState::Ok => None,
        AnchorState::Stale => Some("対象が現在の本文に見つかりません"),
        AnchorState::NoFile => Some("ファイルが見つかりません"),
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
    use super::super::store::{Origin, Thread};
    use super::*;

    fn view(anchor: AnchorState) -> ThreadView {
        ThreadView {
            thread: Thread {
                id: "a3f10000".into(),
                file: "/docs/05_要件定義書.md".into(),
                quote: "生成AIの利用料金は、従来のSaaSと費用構造が異なる。".into(),
                block_hash: "h".into(),
                selection: "費用構造が異なる".into(),
                selection_offset: 12,
                section_path: vec!["背景".into(), "費用構造".into()],
                base_version: "aaaaaaaabbbb".into(),
                status: Status::Open,
                comments: vec![super::super::store::Comment {
                    id: "c1".into(),
                    author: "汲田 晶".into(),
                    body: "「根本的に」を入れて".into(),
                    created_at: 1_772_183_400_000,
                }],
                created_at: 1_772_183_400_000,
            },
            anchor,
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

    #[test]
    fn empty_input_says_so() {
        assert_eq!(threads_markdown(&[]), "未解決の指摘はありません。");
    }

    #[test]
    fn quote_is_always_included() {
        for anchor in [AnchorState::Ok, AnchorState::Stale, AnchorState::NoFile] {
            let md = threads_markdown(&[view(anchor)]);
            assert!(
                md.contains("> 生成AIの利用料金は、従来のSaaSと費用構造が異なる。"),
                "{anchor:?} で指摘時の本文が落ちた"
            );
            assert!(md.contains("指摘時の本文:"), "{anchor:?}");
        }
    }

    #[test]
    fn stale_anchor_is_labelled_and_ok_is_not() {
        let ok = threads_markdown(&[view(AnchorState::Ok)]);
        assert!(ok.contains("### 指摘 #a3f10000\n"));
        assert!(!ok.contains("見つかりません"));

        let stale = threads_markdown(&[view(AnchorState::Stale)]);
        assert!(stale.contains("対象が現在の本文に見つかりません"));

        let gone = threads_markdown(&[view(AnchorState::NoFile)]);
        assert!(gone.contains("ファイルが見つかりません"));
    }

    #[test]
    fn header_carries_section_path_and_versions() {
        let md = threads_markdown(&[view(AnchorState::Ok)]);
        assert!(md.contains("## /docs/05_要件定義書.md"));
        assert!(md.contains("場所: 背景 › 費用構造"));
        assert!(md.contains("指摘時 aaaaaaaa (2026-02-27T09:10:00Z)"));
        assert!(md.contains("現在 cccccccc (2026-02-27T11:00:00Z \"指摘1〜3に対応\")"));
    }

    #[test]
    fn file_heading_is_written_once_per_file() {
        let md = threads_markdown(&[view(AnchorState::Ok), view(AnchorState::Stale)]);
        assert_eq!(md.matches("## /docs/05_要件定義書.md").count(), 1);
        assert_eq!(md.matches("### 指摘 #").count(), 2);
    }

    #[test]
    fn section_path_falls_back_for_top_of_file() {
        let mut v = view(AnchorState::Ok);
        v.thread.section_path.clear();
        assert!(threads_markdown(&[v]).contains("場所: (ファイル先頭)"));
    }

    #[test]
    fn selection_is_omitted_when_it_equals_the_quote() {
        let mut v = view(AnchorState::Ok);
        v.thread.selection = v.thread.quote.clone();
        let md = threads_markdown(&[v]);
        assert!(!md.contains("選択された箇所:"));
    }

    #[test]
    fn multiline_quote_is_prefixed_per_line() {
        let mut v = view(AnchorState::Ok);
        v.thread.quote = "| 定数名 | 値 |\n| --- | --- |\n| EMAIL | email |".into();
        let md = threads_markdown(&[v]);
        assert!(md.contains("> | 定数名 | 値 |"));
        assert!(md.contains("> | EMAIL | email |"));
    }

    #[test]
    fn resolved_threads_show_who_and_when() {
        let mut v = view(AnchorState::Ok);
        v.thread.status = Status::Resolved {
            by: "汲田 晶".into(),
            at: 1_772_190_000_000,
        };
        let md = threads_markdown(&[v]);
        assert!(md.contains("解決済み（汲田 晶 / 2026-02-27T11:00:00Z）"));
    }
}
