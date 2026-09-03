use std::path::PathBuf;
use std::process::Command;

mod cli;
#[cfg(target_os = "macos")]
mod dock;
pub mod review;
mod windows;

// 第 1 引数が review のときは CLI として動き、Tauri を初期化せずに終了する。
// エージェントは GUI が起動していない状態でも指摘を読み書きする。
pub fn run_cli_if_requested() -> bool {
    // args_os を使う。args は UTF-8 でない引数で panic するため、
    // Finder からの起動時に渡る引数で落ちる余地を残さない。
    let first = std::env::args_os().nth(1);
    if first.as_ref().and_then(|a| a.to_str()) != Some("review") {
        return false;
    }
    if let Err(message) = cli::run() {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
    true
}

// レビューの台帳のパスを返す。フロントエンドは読み取りをこのファイルの
// 直読みで行うため、置き場所だけを教える。
#[tauri::command]
fn review_store_path() -> Result<String, String> {
    review::store::ledger_path()?
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "台帳のパスを文字列にできません".to_string())
}

#[tauri::command]
async fn review_create_thread(
    file: String,
    quote: String,
    selection: String,
    selection_offset: usize,
    section_path: Vec<String>,
    source: String,
    author: String,
    body: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        review::create_thread(review::NewThread {
            file: PathBuf::from(file),
            quote,
            selection,
            selection_offset,
            section_path,
            source,
            author,
            body,
        })
    })
    .await
    .map_err(|e| format!("指摘の作成に失敗しました: {e}"))?
}

// 版の本文を返す。差分表示のために、指摘を付けた時点の全文を読む。
#[tauri::command]
async fn review_version_text(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || review::snapshot::get(&id))
        .await
        .map_err(|e| format!("版の読み込みに失敗しました: {e}"))?
}

// GUI が求めた対応付けの結果を控える。CLI はこれを読んで「現在の本文」を出す。
#[tauri::command]
async fn review_set_resolved(
    thread: String,
    state: String,
    head_quote: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        review::set_resolved(&thread, &state, &head_quote)
    })
    .await
    .map_err(|e| format!("対応付けの記録に失敗しました: {e}"))?
}

#[tauri::command]
async fn review_reply(thread: String, author: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::reply(&thread, &author, &body))
        .await
        .map_err(|e| format!("返信に失敗しました: {e}"))?
}

#[tauri::command]
async fn review_remove(thread: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::remove(&thread))
        .await
        .map_err(|e| format!("指摘の取り消しに失敗しました: {e}"))?
}

#[tauri::command]
async fn review_edit_comment(
    thread: String,
    comment: String,
    body: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::edit_comment(&thread, &comment, &body))
        .await
        .map_err(|e| format!("書き込みの書き直しに失敗しました: {e}"))?
}

#[tauri::command]
async fn review_resolve(thread: String, by: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::resolve(&thread, &by))
        .await
        .map_err(|e| format!("解決に失敗しました: {e}"))?
}

#[tauri::command]
async fn review_reopen(thread: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::reopen(&thread))
        .await
        .map_err(|e| format!("解決を取り消せませんでした: {e}"))?
}

#[tauri::command]
async fn review_resolve_many(threads: Vec<String>, by: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || review::resolve_many(&threads, &by))
        .await
        .map_err(|e| format!("解決に失敗しました: {e}"))?
}

// 外部エディタで開く。opener プラグイン経由だと detached 起動で終了コードが
// 取れず、アプリ未インストール時に無反応になるため、自前で `open -a` を実行して
// 結果を返す。
#[tauri::command]
async fn open_in_app(app: String, path: String) -> Result<(), String> {
    let status = tauri::async_runtime::spawn_blocking(move || {
        Command::new("/usr/bin/open")
            .arg("-a")
            .arg(&app)
            .arg("--")
            .arg(&path)
            .status()
    })
    .await
    .map_err(|e| format!("起動処理に失敗しました: {e}"))?
    .map_err(|e| format!("open コマンドを実行できませんでした: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("アプリを起動できませんでした。インストールされているか確認してください。".into())
    }
}

// フォルダ配下の Markdown の更新時刻を、1 回の呼び出しでまとめて返す。
// ファイルごとに stat を投げると、数百ファイルで往復が積み上がってフォルダを
// 開くのが目に見えて遅くなる。走査は Rust 側で完結させる。
#[derive(serde::Serialize)]
struct FileStamp {
    // フォルダからの相対パス（/ 区切り）
    path: String,
    // 更新時刻（エポックからのミリ秒）
    mtime: u64,
}

const SKIP_DIRS: [&str; 6] = [
    "node_modules",
    ".obsidian",
    ".trash",
    ".vscode",
    ".idea",
    "dist",
];

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".md", ".markdown", ".mdx", ".mdown", ".mkd"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn stamps_in(dir: &std::path::Path, prefix: &str, out: &mut Vec<FileStamp>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            stamps_in(&entry.path(), &rel, out);
        } else if kind.is_file() && is_markdown(&name) {
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(FileStamp { path: rel, mtime });
        }
    }
}

#[tauri::command]
async fn folder_mtimes(root: String) -> Vec<FileStamp> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        stamps_in(std::path::Path::new(&root), "", &mut out);
        out
    })
    .await
    .unwrap_or_default()
}

// 指定したアプリ名のうち、実際にインストールされているものを返す。
// メニューに出す項目を実在するアプリだけに絞るために使う。
#[tauri::command]
async fn installed_apps(apps: Vec<String>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut roots: Vec<PathBuf> = vec![PathBuf::from("/Applications")];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Applications"));
        }
        apps.into_iter()
            .filter(|name| {
                roots
                    .iter()
                    .any(|root| root.join(format!("{name}.app")).exists())
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_in_app,
            installed_apps,
            folder_mtimes,
            review_store_path,
            review_create_thread,
            review_version_text,
            review_set_resolved,
            review_reply,
            review_resolve,
            review_reopen,
            review_resolve_many,
            review_remove,
            review_edit_comment,
            windows::open_doc_window,
            windows::set_window_title,
            windows::record_recent_folder
        ])
        .setup(|app| {
            // Dock アイコンのメニュー（macOS のみ。失敗しても起動は続ける）
            #[cfg(target_os = "macos")]
            dock::install(app.handle());
            // 自動更新（デスクトップのみ）
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
