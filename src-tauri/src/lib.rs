use std::path::PathBuf;
use std::process::Command;

mod cli;
pub mod review;

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

#[tauri::command]
async fn review_reply(thread: String, author: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::reply(&thread, &author, &body))
        .await
        .map_err(|e| format!("返信に失敗しました: {e}"))?
}

#[tauri::command]
async fn review_resolve(thread: String, by: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::resolve(&thread, &by))
        .await
        .map_err(|e| format!("解決に失敗しました: {e}"))?
}

#[tauri::command]
async fn review_commit(file: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || review::commit(&PathBuf::from(file), &message))
        .await
        .map_err(|e| format!("版の記録に失敗しました: {e}"))?
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
            review_store_path,
            review_create_thread,
            review_reply,
            review_resolve,
            review_commit
        ])
        .setup(|app| {
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
