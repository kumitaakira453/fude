use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use std::ffi::CString;
use std::sync::OnceLock;
use tauri::AppHandle;

// Dock アイコンのメニュー。
//
// 開いているウィンドウの一覧は macOS が勝手に並べる（ウィンドウのタイトルを
// フォルダ名にしてあるので、そのままフォルダの一覧になる）。ここで足すのは
// 「新しいウィンドウ」と「最近開いたフォルダ」だけ。
//
// Tauri v2 に Dock メニューの API は無いので、tao が作ったアプリケーション
// デリゲートのクラスに applicationDockMenu: を後付けする。tao はこのセレクタを
// 実装していないため、上書きではなく追加になる。
// setDelegate: は呼ばない。Dock からの復帰・URL の受け取り・終了処理が
// すべてそのデリゲートに乗っており、差し替えると全部壊れる。
// クラスは private な名前で引かず、動いているデリゲート自身から取る。

static APP: OnceLock<AppHandle> = OnceLock::new();

// 「最近開いたフォルダ」以外の項目を表すタグ。
const TAG_NEW_WINDOW: isize = -1;

type MenuFn = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject;
type ActionFn = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject);

pub fn install(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return; // 既に入れてある
    }
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if ns_app.is_null() {
            log::warn!("Dock メニューを追加できません: NSApplication がありません");
            return;
        }
        let delegate: *mut AnyObject = msg_send![ns_app, delegate];
        if delegate.is_null() {
            log::warn!("Dock メニューを追加できません: デリゲートがありません");
            return;
        }
        let class = (*delegate).class() as *const AnyClass as *mut AnyClass;
        let menu: Imp = std::mem::transmute::<MenuFn, Imp>(dock_menu);
        let new_window: Imp = std::mem::transmute::<ActionFn, Imp>(new_window);
        let open_recent: Imp = std::mem::transmute::<ActionFn, Imp>(open_recent);
        // 型エンコーディング: @=オブジェクト, v=戻り値なし, :=セレクタ
        add_method(class, sel!(applicationDockMenu:), menu, b"@@:@\0");
        add_method(class, sel!(mdglowNewWindow:), new_window, b"v@:@\0");
        add_method(class, sel!(mdglowOpenRecent:), open_recent, b"v@:@\0");
    }
}

unsafe fn add_method(class: *mut AnyClass, sel: Sel, imp: Imp, types: &[u8]) {
    let added = objc2::ffi::class_addMethod(class, sel, imp, types.as_ptr().cast());
    if !added.as_bool() {
        log::warn!("Dock メニューの {sel:?} を追加できませんでした");
    }
}

unsafe fn ns_string(text: &str) -> *mut AnyObject {
    let c = CString::new(text).unwrap_or_default();
    msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()]
}

unsafe fn add_item(menu: &AnyObject, title: &str, action: Sel, target: *mut AnyObject, tag: isize) {
    let title = ns_string(title);
    let key = ns_string("");
    let item: *mut AnyObject = msg_send![menu, addItemWithTitle: title, action: action, keyEquivalent: key];
    if item.is_null() {
        return;
    }
    let _: () = msg_send![item, setTarget: target];
    let _: () = msg_send![item, setTag: tag];
}

// メニューはクリックのたびに引かれる。その場で作り直せばよく、
// 開いたフォルダが増えたことを Dock 側へ知らせる必要はない。
extern "C-unwind" fn dock_menu(this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut AnyObject {
    unsafe {
        let menu: Retained<AnyObject> = msg_send![class!(NSMenu), new];
        let target = this as *const AnyObject as *mut AnyObject;
        add_item(
            &menu,
            "新しいウィンドウ",
            sel!(mdglowNewWindow:),
            target,
            TAG_NEW_WINDOW,
        );
        let recent = crate::windows::recent_folders();
        if !recent.is_empty() {
            let separator: *mut AnyObject = msg_send![class!(NSMenuItem), separatorItem];
            let _: () = msg_send![&*menu, addItem: separator];
        }
        for (i, folder) in recent.iter().enumerate() {
            add_item(&menu, &folder.name, sel!(mdglowOpenRecent:), target, i as isize);
        }
        // AppKit は autorelease されたメニューを期待する
        Retained::autorelease_return(menu)
    }
}

extern "C-unwind" fn new_window(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) {
    let Some(app) = APP.get() else { return };
    if let Err(e) = crate::windows::open_doc_window(
        app.clone(),
        "index.html".to_string(),
        "mdglow".to_string(),
    ) {
        log::warn!("Dock メニューからウィンドウを開けません: {e}");
    }
}

extern "C-unwind" fn open_recent(_this: &AnyObject, _cmd: Sel, sender: *mut AnyObject) {
    if sender.is_null() {
        return;
    }
    let tag: isize = unsafe { msg_send![sender, tag] };
    let Ok(index) = usize::try_from(tag) else {
        return;
    };
    let recent = crate::windows::recent_folders();
    let Some(folder) = recent.get(index) else {
        return;
    };
    let Some(app) = APP.get() else { return };
    if let Err(e) = crate::windows::open_folder_window(app, &folder.path) {
        log::warn!("Dock メニューからフォルダを開けません: {e}");
    }
}
