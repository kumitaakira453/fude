// 開いているフォルダの見張り。
//
// fs プラグインの watch は使わない。あれは同期の命令でメインスレッドに乗り、
// 間合いを指定すると、名前の変更を組むための控えを作るためにフォルダ全体を
// 辿る（node_modules も .git も）。大きなフォルダでは数秒、画面が止まる。
// ここでは OS の通知（macOS は FSEvents）を素で受け、辿らない。

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use ignore::gitignore::Gitignore;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::ipc::Channel;

// 合図をためる間。続けて来た分（保存の書き換え、git の切り替え）を 1 回で送る。
const GATHER: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct Watches {
    next: Mutex<u32>,
    live: Mutex<HashMap<u32, RecommendedWatcher>>,
}

// 道筋が外したものに当たるか。合図は消えたファイルにも来るので、在るかどうかは
// 頼れない。外した置き場の下にあるかで見る。
fn excluded(gi: &Gitignore, root: &Path, abs: &Path) -> bool {
    let Ok(rel) = abs.strip_prefix(root) else {
        return false;
    };
    if rel.as_os_str().is_empty() {
        return false;
    }
    gi.matched_path_or_any_parents(rel, abs.is_dir()).is_ignore()
}

// 送る値打ちのある合図か。道筋が 1 つでも外していないものに当たれば残す。
fn worth(event: &Event, gi: &Gitignore, root: &Path) -> bool {
    event.paths.is_empty() || event.paths.iter().any(|p| !excluded(gi, root, p))
}

// 届いた合図を間合いの分だけためて、外したものを除いてから送る。見張りが
// 捨てられると送り口が閉じ、この手も終わる。
fn gather(rx: mpsc::Receiver<Event>, gi: Gitignore, root: std::path::PathBuf, out: Channel<Vec<Event>>) {
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        let until = Instant::now() + GATHER;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(event) => batch.push(event),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        batch.retain(|e| worth(e, &gi, &root));
        if !batch.is_empty() && out.send(batch).is_err() {
            return;
        }
    }
}

#[tauri::command]
pub async fn watch_folder(
    watches: tauri::State<'_, Watches>,
    root: String,
    ignore: String,
    recursive: bool,
    on_event: Channel<Vec<Event>>,
) -> Result<u32, String> {
    let watcher = tauri::async_runtime::spawn_blocking(move || {
        let gi = crate::ignore_of(&root, &ignore);
        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        })
        .map_err(|e| format!("{root} を見張れません: {e}"))?;
        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        watcher
            .watch(Path::new(&root), mode)
            .map_err(|e| format!("{root} を見張れません: {e}"))?;
        let at = std::path::PathBuf::from(&root);
        std::thread::spawn(move || gather(rx, gi, at, on_event));
        Ok::<_, String>(watcher)
    })
    .await
    .map_err(|e| e.to_string())??;
    let id = {
        let mut next = watches.next.lock().map_err(|e| e.to_string())?;
        *next += 1;
        *next
    };
    watches
        .live
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, watcher);
    Ok(id)
}

#[tauri::command]
pub async fn unwatch_folder(watches: tauri::State<'_, Watches>, id: u32) -> Result<(), String> {
    let watcher = watches.live.lock().map_err(|e| e.to_string())?.remove(&id);
    // 片付けは OS の購読を外すので、メインスレッドの外で行う。
    if let Some(w) = watcher {
        let _ = tauri::async_runtime::spawn_blocking(move || drop(w)).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind};
    use std::path::PathBuf;

    fn event(paths: &[&str]) -> Event {
        let mut e = Event::new(EventKind::Create(CreateKind::File));
        for p in paths {
            e = e.add_path(PathBuf::from(p));
        }
        e
    }

    #[test]
    fn 外した置き場の下の合図は捨てる() {
        let root = Path::new("/w");
        let gi = crate::ignore_of("/w", "node_modules/\n.*/\n");
        assert!(!worth(&event(&["/w/node_modules/a/b.js"]), &gi, root));
        assert!(!worth(&event(&["/w/.git/index"]), &gi, root));
        assert!(!worth(&event(&["/w/x/node_modules/a.js"]), &gi, root));
    }

    #[test]
    fn 外していない道筋が_1_つでもあれば残す() {
        let root = Path::new("/w");
        let gi = crate::ignore_of("/w", "node_modules/\n");
        assert!(worth(&event(&["/w/docs/a.md"]), &gi, root));
        assert!(worth(&event(&["/w/node_modules/a.md", "/w/a.md"]), &gi, root));
        assert!(worth(&event(&[]), &gi, root));
    }

    #[test]
    fn 根の外の道筋は外さない() {
        let gi = crate::ignore_of("/w", "node_modules/\n");
        assert!(worth(&event(&["/elsewhere/node_modules/a"]), &gi, Path::new("/w")));
    }
}
