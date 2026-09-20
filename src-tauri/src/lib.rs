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
    // 項目・セルを丸ごと対象にしたときの引き先。無い指摘では省かれる。
    unit: Option<review::store::Unit>,
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
            unit,
        })
    })
    .await
    .map_err(|e| format!("コメントの作成に失敗しました: {e}"))?
}

// 版の本文を返す。差分表示のために、指摘を付けた時点の全文を読む。
#[tauri::command]
async fn review_version_text(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || review::snapshot::get(&id))
        .await
        .map_err(|e| format!("版の読み込みに失敗しました: {e}"))?
}

// 人が明示的に版を打つ。画面に出ている本文をそのまま渡す。
#[tauri::command]
async fn review_checkpoint(
    file: String,
    text: String,
    label: Option<String>,
) -> Result<review::Checkpointed, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // GUI から打つ版は人の操作。エージェントは CLI から打つ。
        review::checkpoint(
            &PathBuf::from(file),
            &text,
            label,
            review::store::Actor::You,
        )
    })
    .await
    .map_err(|e| format!("版の保存に失敗しました: {e}"))?
}

// 過去の版でファイルを置き換える。expect は画面が基準にしている本文で、
// ディスクがそれと違えば外部で書き換わっているので何もせずに知らせる。
#[tauri::command]
async fn review_restore(
    file: String,
    version: String,
    expect: String,
) -> Result<review::Restored, String> {
    tauri::async_runtime::spawn_blocking(move || {
        review::restore(&PathBuf::from(file), &version, &expect)
    })
    .await
    .map_err(|e| format!("復元に失敗しました: {e}"))?
}

// 名前が変わったファイルの指摘と版を、新しいパスへ連れていく。台帳は絶対パスで
// 紐付いているので、これを呼ばないと名前を変えた時点で引けなくなる。
#[tauri::command]
async fn review_move_file(from: String, to: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        review::move_file(&PathBuf::from(from), &PathBuf::from(to))
    })
    .await
    .map_err(|e| format!("コメントの付け替えに失敗しました: {e}"))?
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
        .map_err(|e| format!("コメントの取り消しに失敗しました: {e}"))?
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
async fn review_put_thread(thread: review::store::Thread) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || review::put_thread(thread))
        .await
        .map_err(|e| format!("コメントを戻せませんでした: {e}"))?
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

// 一覧から外すもの。書き方は .gitignore と同じで、設定の本文をそのまま食わせる。
// 壊れた行は効かないだけにする（打っている途中の行で走査が止まらないように）。
fn ignore_of(root: &str, text: &str) -> ignore::gitignore::Gitignore {
    let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
    for line in text.lines() {
        let _ = builder.add_line(None, line);
    }
    builder
        .build()
        .unwrap_or_else(|_| ignore::gitignore::Gitignore::empty())
}

fn dropped(gi: &ignore::gitignore::Gitignore, rel: &str, dir: bool) -> bool {
    gi.matched(rel, dir).is_ignore()
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".md", ".markdown", ".mdx", ".mdown", ".mkd"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn stamps_in(
    dir: &std::path::Path,
    prefix: &str,
    gi: &ignore::gitignore::Gitignore,
    out: &mut Vec<FileStamp>,
) {
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
            if dropped(gi, &rel, true) {
                continue;
            }
            stamps_in(&entry.path(), &rel, gi, out);
        } else if kind.is_file() && is_markdown(&name) && !dropped(gi, &rel, false) {
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
async fn folder_mtimes(root: String, ignore: String) -> Vec<FileStamp> {
    tauri::async_runtime::spawn_blocking(move || {
        let gi = ignore_of(&root, &ignore);
        let mut out = Vec::new();
        stamps_in(std::path::Path::new(&root), "", &gi, &mut out);
        out
    })
    .await
    .unwrap_or_default()
}

// フォルダ配下の木を、1 回の呼び出しでまとめて返す。階層ごとに読み出しを
// 投げると往復が階層の数だけ積み上がり、一覧に出さないファイルまで WebView へ
// 渡ることになる（ビルド成果物を抱えたフォルダでは 4 万件のうち 9 割が捨てる分）。
#[derive(serde::Serialize)]
struct ScanEntry {
    // フォルダからの相対パス（/ 区切り）
    path: String,
    dir: bool,
}

// 拡張子だけの粗いふるい。only が空でなければその拡張子だけを、skip が空で
// なければその拡張子以外を通す。何を一覧に出すかの決めごとは呼び出し側が持つ。
struct Sieve {
    only: std::collections::HashSet<String>,
    skip: std::collections::HashSet<String>,
}

impl Sieve {
    fn passes(&self, name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        let ext = lower.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        if !self.only.is_empty() {
            return !ext.is_empty() && self.only.contains(ext);
        }
        if !self.skip.is_empty() {
            return ext.is_empty() || !self.skip.contains(ext);
        }
        true
    }
}

// 親を子より先に積む。受け取った側はこの順のまま木へ組める。
// depth は残りの階層で、1 ならその階層で止まる。0 は限りなし。
fn scan_in(
    dir: &std::path::Path,
    prefix: &str,
    sieve: &Sieve,
    gi: &ignore::gitignore::Gitignore,
    depth: u32,
    out: &mut Vec<ScanEntry>,
) {
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
            // 外した置き場には降りない。出さないものを読むためだけに、その下を
            // 全部辿ることになる。
            if dropped(gi, &rel, true) {
                continue;
            }
            // 空のフォルダも一覧に出す。新しく作った置き場が消えて見える。
            out.push(ScanEntry {
                path: rel.clone(),
                dir: true,
            });
            if depth != 1 {
                scan_in(
                    &entry.path(),
                    &rel,
                    sieve,
                    gi,
                    depth.saturating_sub(1),
                    out,
                );
            }
        } else if kind.is_file() && sieve.passes(&name) && !dropped(gi, &rel, false) {
            out.push(ScanEntry { path: rel, dir: false });
        }
    }
}

#[tauri::command]
async fn scan_tree(
    root: String,
    only: Vec<String>,
    skip: Vec<String>,
    ignore: String,
    depth: u32,
) -> Vec<ScanEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        let sieve = Sieve {
            only: only.into_iter().collect(),
            skip: skip.into_iter().collect(),
        };
        let gi = ignore_of(&root, &ignore);
        let mut out = Vec::new();
        scan_in(std::path::Path::new(&root), "", &sieve, &gi, depth, &mut out);
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            open_in_app,
            installed_apps,
            folder_mtimes,
            scan_tree,
            review_store_path,
            review_create_thread,
            review_version_text,
            review_checkpoint,
            review_restore,
            review_move_file,
            review_set_resolved,
            review_reply,
            review_resolve,
            review_reopen,
            review_put_thread,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sieve(only: &[&str], skip: &[&str]) -> Sieve {
        Sieve {
            only: only.iter().map(|s| s.to_string()).collect(),
            skip: skip.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn only_はその拡張子だけを通す() {
        let s = sieve(&["md", "markdown"], &[]);
        assert!(s.passes("はじめ.md"));
        assert!(s.passes("大文字.MD"));
        assert!(!s.passes("絵.png"));
        // 拡張子の無い名前は通さない。
        assert!(!s.passes("Makefile"));
        // 点で始まる名前も、後ろが合えば通す。
        assert!(s.passes(".md"));
    }

    #[test]
    fn skip_はその拡張子以外を通す() {
        let s = sieve(&[], &["zip", "png"]);
        assert!(s.passes("はじめ.md"));
        assert!(!s.passes("書庫.zip"));
        assert!(!s.passes("絵.PNG"));
        // 拡張子の無い名前は字として開けるので通す。
        assert!(s.passes("Makefile"));
        assert!(s.passes(".gitignore"));
    }

    #[test]
    fn ふるいが空なら全部通す() {
        let s = sieve(&[], &[]);
        assert!(s.passes("書庫.zip"));
        assert!(s.passes("Makefile"));
    }

    // 走査の試し場。テストごとに別の置き場を作り、終わりに畳む。
    struct Yard(std::path::PathBuf);

    impl Yard {
        fn new(tag: &str, files: &[&str]) -> Yard {
            let root = std::env::temp_dir()
                .join(format!("fude-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            for rel in files {
                let at = root.join(rel);
                if rel.ends_with('/') {
                    std::fs::create_dir_all(&at).unwrap();
                } else {
                    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
                    std::fs::write(&at, "").unwrap();
                }
            }
            Yard(root)
        }

        fn scan(&self, ignore: &str, depth: u32) -> Vec<String> {
            let gi = ignore_of(&self.0.to_string_lossy(), ignore);
            let mut out = Vec::new();
            scan_in(&self.0, "", &sieve(&["md"], &[]), &gi, depth, &mut out);
            let mut paths: Vec<String> = out.into_iter().map(|e| e.path).collect();
            paths.sort();
            paths
        }
    }

    impl Drop for Yard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const TREE: [&str; 7] = [
        "はじめ.md",
        "log/根の直下.md",
        "中/奥.md",
        "中/log/深い.md",
        "中/残す.md",
        "中/一時/x.md",
        "node_modules/何か/紛れ.md",
    ];

    #[test]
    fn 走査は親を先に積む() {
        let yard = Yard::new("order", &["中/奥/深い.md"]);
        let gi = ignore_of(&yard.0.to_string_lossy(), "");
        let mut out = Vec::new();
        scan_in(&yard.0, "", &sieve(&["md"], &[]), &gi, 0, &mut out);
        let at = |p: &str| out.iter().position(|e| e.path == p).unwrap();
        assert!(at("中") < at("中/奥"));
        assert!(at("中/奥") < at("中/奥/深い.md"));
    }

    #[test]
    fn 末尾のスラッシュで置き場を丸ごと外す() {
        let yard = Yard::new("dir", &TREE);
        let got = yard.scan("node_modules/\n", 0);
        assert!(!got.iter().any(|p| p.starts_with("node_modules")));
        assert!(got.contains(&"はじめ.md".to_string()));
    }

    #[test]
    fn 名前だけならどの階層でも_頭のスラッシュなら根の直下だけ() {
        let yard = Yard::new("root", &TREE);
        let anywhere = yard.scan("log/\n", 0);
        assert!(!anywhere.iter().any(|p| p.contains("log")));

        let only_top = yard.scan("/log/\n", 0);
        assert!(!only_top.contains(&"log".to_string()));
        assert!(only_top.contains(&"中/log/深い.md".to_string()));
    }

    #[test]
    fn 感嘆符で戻せる_ただし外した置き場の中は戻らない() {
        let yard = Yard::new("negate", &TREE);
        let got = yard.scan("中/*.md\n!中/残す.md\n", 0);
        assert!(!got.contains(&"中/奥.md".to_string()));
        assert!(got.contains(&"中/残す.md".to_string()));

        // 置き場ごと外したときは、中のものを名指しで戻しても出てこない。
        let dropped = yard.scan("node_modules/\n!node_modules/何か/紛れ.md\n", 0);
        assert!(!dropped.iter().any(|p| p.starts_with("node_modules")));
    }

    #[test]
    fn 星は区切りをまたがず_二つ重ねるとまたぐ() {
        let yard = Yard::new("star", &TREE);
        // * は 1 階層ぶん。中/一時 には当たらない。
        let shallow = yard.scan("/*時/\n", 0);
        assert!(shallow.contains(&"中/一時".to_string()));

        let deep = yard.scan("**/一時/\n", 0);
        assert!(!deep.contains(&"中/一時".to_string()));
    }

    #[test]
    fn 深さ_1_はその階層だけ返す() {
        let yard = Yard::new("depth", &TREE);
        assert_eq!(
            yard.scan("", 1),
            vec!["log", "node_modules", "はじめ.md", "中"]
        );
    }
}
