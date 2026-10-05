use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::windows::app_dir;

// ワークスペース（並べるフォルダとタブの組）の控えと、どの窓がどれを開いているか。
//
// 中身を組み立てるのは画面の側で、ここは 1 つを 1 ファイルとして置くだけ。
// 窓はそれぞれ自分のワークスペースのファイルしか書かないので、書き込みが
// ぶつからない。Dock のメニューと起動し直したときの復元のために Rust からも読む。

fn dir() -> Result<PathBuf, String> {
    Ok(app_dir()?.join("workspaces"))
}

// ID はファイル名になる。外から来た字で道筋を作らないよう、字を絞る。
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn file_of(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("ワークスペースの ID が不正です: {id}"));
    }
    Ok(dir()?.join(format!("{id}.json")))
}

fn last_opened(ws: &Value) -> i64 {
    ws.get("lastOpened").and_then(Value::as_i64).unwrap_or(0)
}

// 新しく開いた順。読めないファイルは飛ばす（1 つ壊れても一覧は出す）。
pub fn all() -> Vec<Value> {
    let Ok(entries) = dir().and_then(|d| fs::read_dir(d).map_err(|e| e.to_string())) else {
        return Vec::new();
    };
    let mut list: Vec<Value> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .filter_map(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(|ws| ws.get("id").and_then(Value::as_str).is_some_and(valid_id))
        .collect();
    list.sort_by_key(|ws| std::cmp::Reverse(last_opened(ws)));
    list
}

#[tauri::command]
pub async fn list_workspaces() -> Vec<Value> {
    tauri::async_runtime::spawn_blocking(all)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn save_workspace(workspace: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = workspace
            .get("id")
            .and_then(Value::as_str)
            .ok_or("ワークスペースに ID がありません")?;
        let file = file_of(id)?;
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("{} を作れません: {e}", parent.display()))?;
        }
        let bytes = serde_json::to_vec(&workspace).map_err(|e| e.to_string())?;
        crate::review::store::write_atomic(&file, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_workspace(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = file_of(&id)?;
        match fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{} を消せません: {e}", file.display())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- 窓とワークスペースの対応 ----
//
// 起動し直したときに、終了したときの窓を戻すための控え。窓を閉じたら閉じた
// 時刻を付ける。終了でまとめて閉じた窓は時刻がほぼそろうので、最後にまとめて
// 閉じた分（と、閉じる前に落ちた分）を戻す。前もって 1 枚ずつ閉じた窓は戻さない。
// 終了と窓の破棄の届く順番に頼らずに済む。

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub workspace: String,
    #[serde(default)]
    pub closed_at: Option<i64>,
}

type Bindings = BTreeMap<String, Binding>;

// まとめて閉じたと見なす幅（ミリ秒）。
const CLOSED_TOGETHER: i64 = 3000;

static BINDINGS: Mutex<()> = Mutex::new(());
static RESTORE_TAKEN: AtomicBool = AtomicBool::new(false);

fn bindings_path() -> Result<PathBuf, String> {
    Ok(app_dir()?.join("open-windows.json"))
}

fn read_bindings() -> Bindings {
    bindings_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_bindings(map: &Bindings) -> Result<(), String> {
    let file = bindings_path()?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{} を作れません: {e}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
    crate::review::store::write_atomic(&file, &bytes)
}

fn update_bindings(change: impl FnOnce(&mut Bindings)) -> Result<(), String> {
    let _guard = BINDINGS.lock().map_err(|e| e.to_string())?;
    let mut map = read_bindings();
    let before = map.clone();
    change(&mut map);
    if map == before {
        return Ok(());
    }
    write_bindings(&map)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// 戻す窓。閉じていない窓と、最後にまとめて閉じた窓。主窓を先頭にする。
pub fn to_restore(map: &Bindings) -> Vec<(String, String)> {
    let last = map.values().filter_map(|b| b.closed_at).max();
    let mut list: Vec<(String, String)> = map
        .iter()
        .filter(|(_, b)| match (b.closed_at, last) {
            (None, _) => true,
            (Some(at), Some(last)) => at >= last - CLOSED_TOGETHER,
            (Some(_), None) => false,
        })
        .map(|(label, b)| (label.clone(), b.workspace.clone()))
        .collect();
    list.sort_by_key(|(label, _)| label != "main");
    list
}

// この窓が開いているワークスペース。None なら外す（1 枚だけ開く窓など）。
#[tauri::command]
pub async fn bind_window(label: String, workspace: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_bindings(|map| match workspace {
            Some(ws) => {
                map.insert(
                    label,
                    Binding {
                        workspace: ws,
                        closed_at: None,
                    },
                );
            }
            None => {
                map.remove(&label);
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// 窓が閉じた。終了でまとめて閉じたのか 1 枚だけ閉じたのかは、時刻で後から見分ける。
pub fn window_closed(label: &str) {
    let at = now_ms();
    if let Err(e) = update_bindings(|map| {
        if let Some(b) = map.get_mut(label) {
            b.closed_at = Some(at);
        }
    }) {
        log::warn!("窓の控えを書けません: {e}");
    }
}

// 起動して最初の 1 回だけ、戻す窓を返す（主窓を作り直しても二度は開かない）。
// 返したら、閉じた窓の控えは捨てる。開き直した窓は自分で控え直す。
#[tauri::command]
pub async fn take_restore() -> Vec<(String, String)> {
    if RESTORE_TAKEN.swap(true, Ordering::SeqCst) {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = BINDINGS.lock();
        let map = read_bindings();
        let list = to_restore(&map);
        if let Err(e) = write_bindings(&Bindings::new()) {
            log::warn!("窓の控えを空にできません: {e}");
        }
        list
    })
    .await
    .unwrap_or_default()
}

// そのワークスペースを開いている窓があれば前に出す。出したら true。
// except は頼んできた窓自身（自分を前に出しても切り替えにならない）。
#[tauri::command]
pub fn focus_workspace(app: AppHandle, workspace: String, except: Option<String>) -> bool {
    let map = read_bindings();
    for (label, b) in &map {
        if b.workspace != workspace || b.closed_at.is_some() {
            continue;
        }
        if except.as_deref() == Some(label.as_str()) {
            continue;
        }
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
            return true;
        }
    }
    false
}

// いま開いている窓とそのワークスペース（窓の名前, ID）。切り替えの一覧に
// 「別の窓で開いている」を出すのに使う。
#[tauri::command]
pub fn live_workspaces(app: AppHandle) -> Vec<(String, String)> {
    read_bindings()
        .into_iter()
        .filter(|(label, b)| b.closed_at.is_none() && app.get_webview_window(label).is_some())
        .map(|(label, b)| (label, b.workspace))
        .collect()
}

// Dock などから開く。開いている窓があれば前に出し、無ければ新しい窓で開く。
pub fn open_workspace_window(app: &AppHandle, id: &str, name: &str) -> Result<(), String> {
    if focus_workspace(app.clone(), id.to_string(), None) {
        return Ok(());
    }
    crate::windows::open_doc_window(
        app.clone(),
        format!("index.html#ws={id}"),
        name.to_string(),
        None,
        None,
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind(ws: &str, closed_at: Option<i64>) -> Binding {
        Binding {
            workspace: ws.to_string(),
            closed_at,
        }
    }

    #[test]
    fn id_は小文字と数字とハイフンだけ() {
        assert!(valid_id("ws-1a2b"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("WS"));
        assert!(!valid_id(&"a".repeat(65)));
    }

    #[test]
    fn 終了でまとめて閉じた窓を戻し_前に閉じた窓は戻さない() {
        let mut map = Bindings::new();
        map.insert("doc-1".into(), bind("a", Some(10_000)));
        map.insert("main".into(), bind("b", Some(100_000)));
        map.insert("doc-2".into(), bind("c", Some(99_000)));
        assert_eq!(
            to_restore(&map),
            vec![("main".into(), "b".into()), ("doc-2".into(), "c".into())]
        );
    }

    #[test]
    fn 閉じる前に落ちた窓も戻す() {
        let mut map = Bindings::new();
        map.insert("doc-1".into(), bind("a", None));
        map.insert("main".into(), bind("b", None));
        assert_eq!(
            to_restore(&map),
            vec![("main".into(), "b".into()), ("doc-1".into(), "a".into())]
        );
    }

    #[test]
    fn 最後の窓を閉じてから終了しても_その窓は戻す() {
        let mut map = Bindings::new();
        map.insert("main".into(), bind("b", Some(5_000)));
        assert_eq!(to_restore(&map), vec![("main".into(), "b".into())]);
    }
}
