use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

// 追加ウィンドウの生成と、Dock メニューが読む「最近開いたフォルダ」。
//
// ウィンドウを作るのを Rust 側に置いているのは、プラグイン経由だと ACL の
// 許可漏れで静かに失敗するのに対し、アプリ自作コマンドは ACL の対象外で
// 確実に動くため。新しいウィンドウ自身が fs などのプラグインを使えるかは
// capability の windows（doc-*）で担保する。

// 追加ウィンドウのラベル接頭辞。capability の glob と対応する。
const DOC_PREFIX: &str = "doc-";

pub fn app_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME が設定されていません")?;
    Ok(Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("com.mdglow.app"))
}

fn recent_path() -> Result<PathBuf, String> {
    Ok(app_dir()?.join("recent-folders.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFolder {
    pub path: String,
    pub name: String,
    pub last_opened: i64, // epoch ミリ秒
}

const RECENT_LIMIT: usize = 10;

fn basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

// 新しい順。読めない・壊れている場合は空として扱う（Dock メニューは無くても困らない）。
pub fn recent_folders() -> Vec<RecentFolder> {
    let Ok(path) = recent_path() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut list: Vec<RecentFolder> = serde_json::from_str(&text).unwrap_or_default();
    list.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    list
}

// フォルダを開いたことを控える。Dock メニューは WebView を持たないので、
// IndexedDB にある履歴とは別に Rust から読める形でも残す。
#[tauri::command]
pub fn record_recent_folder(path: String, at: i64) -> Result<(), String> {
    let mut list = recent_folders();
    list.retain(|f| f.path != path);
    list.insert(
        0,
        RecentFolder {
            name: basename(&path),
            path,
            last_opened: at,
        },
    );
    list.truncate(RECENT_LIMIT);
    let file = recent_path()?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?;
    crate::review::store::write_atomic(&file, &bytes)
}

// application/x-www-form-urlencoded。フロントの URLSearchParams がそのまま解釈できる形にする。
fn form_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for &b in value.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// 追加ウィンドウが読み込む URL。フロントは起動時にこのハッシュを解釈して復元する。
pub fn doc_url(folder: &str, file: Option<&str>) -> String {
    let mut url = format!("index.html#folder={}", form_encode(folder));
    if let Some(f) = file.filter(|s| !s.is_empty()) {
        url.push_str(&format!("&file={}", form_encode(f)));
    }
    url
}

fn next_label(app: &AppHandle) -> String {
    let used: HashSet<String> = app.webview_windows().keys().cloned().collect();
    (1..)
        .map(|n| format!("{DOC_PREFIX}{n}"))
        .find(|label| !used.contains(label))
        .unwrap_or_else(|| format!("{DOC_PREFIX}x"))
}

// 直前まで見ていたウィンドウから少しずらして出す。真上に重なると
// 新しく開いたことが分からない。
fn cascade_from(app: &AppHandle) -> Option<(f64, f64)> {
    let win = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))?;
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?.to_logical::<f64>(scale);
    Some((pos.x + 32.0, pos.y + 32.0))
}

// 掴んでいた位置に窓の上端が来るようにずらす量。カーソルがタブの列の
// あたりに乗るので、引き出したものがそのまま置かれたように見える。
const GRAB_OFFSET: (f64, f64) = (-90.0, -14.0);

#[tauri::command]
pub fn open_doc_window(
    app: AppHandle,
    url: String,
    title: String,
    // 引き出して開くときの、離した位置（画面座標）。無ければ既存の窓からずらす。
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let label = next_label(&app);
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1100.0, 780.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        // OS のファイルドロップを掴ませない。掴ませると WebView 内の
        // HTML のドラッグ&ドロップ（タブの移動など）が届かなくなる。
        .disable_drag_drop_handler();
    let dropped_at = x
        .zip(y)
        .map(|(x, y)| (x + GRAB_OFFSET.0, y + GRAB_OFFSET.1));
    builder = match dropped_at.or_else(|| cascade_from(&app)) {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };
    builder
        .build()
        .map_err(|e| format!("ウィンドウを開けませんでした: {e}"))?;
    Ok(label)
}

// Dock メニューなど、フロントを介さずにフォルダを開く経路。
pub fn open_folder_window(app: &AppHandle, folder: &str) -> Result<String, String> {
    open_doc_window(
        app.clone(),
        doc_url(folder, None),
        basename(folder),
        None,
        None,
    )
}

// ウィンドウのタイトルは Dock メニューのウィンドウ一覧にそのまま並ぶ。
// フォルダを切り替えたら追従させる。
#[tauri::command]
pub fn set_window_title(app: AppHandle, label: String, title: String) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("ウィンドウ {label} が見つかりません"))?;
    win.set_title(&title).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ハッシュは_urlsearchparams_が読める形にする() {
        // 空白は +、それ以外の非英数は %XX。日本語は UTF-8 のバイト列。
        assert_eq!(form_encode("a b"), "a+b");
        assert_eq!(form_encode("/tmp/x.md"), "%2Ftmp%2Fx.md");
        assert_eq!(form_encode("あ"), "%E3%81%82");
    }

    #[test]
    fn ファイル指定が無ければ_file_を付けない() {
        assert_eq!(doc_url("/a", None), "index.html#folder=%2Fa");
        assert_eq!(doc_url("/a", Some("")), "index.html#folder=%2Fa");
        assert_eq!(
            doc_url("/a", Some("b.md")),
            "index.html#folder=%2Fa&file=b.md"
        );
    }

    #[test]
    fn 末尾のスラッシュを落としてフォルダ名を取る() {
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(basename("/a/b"), "b");
    }
}
