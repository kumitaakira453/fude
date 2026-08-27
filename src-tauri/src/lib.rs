use std::path::PathBuf;
use std::process::Command;

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
        .invoke_handler(tauri::generate_handler![open_in_app, installed_apps])
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
