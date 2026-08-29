import { buildHash } from "./url";

// Tauri の API は呼ぶときに読み込む。ラベルの取得は素の JS だけで済むので、
// 単体テストからこのモジュールを触っても Tauri を引き込まない。
const invoke = async (cmd: string, args: Record<string, unknown>) =>
  (await import("@tauri-apps/api/core")).invoke(cmd, args);

// 追加ウィンドウ。生成そのものは Rust 側のコマンドが行う。
// ここはラベルの取得と、フォルダ・ファイルを URL に載せる部分だけを持つ。

export const MAIN_LABEL = "main";

// 自分のウィンドウのラベル。Tauri が起動時に埋める値を同期で読むだけで、
// IPC も権限も要らない。Tauri 外（素のブラウザ）では main として扱う。
export function currentWindowLabel(): string {
  if (typeof window === "undefined") return MAIN_LABEL;
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: string } } };
    }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWebview?.label ?? MAIN_LABEL;
}

// ウィンドウごとに持ちたい設定の保存キー。
//
// localStorage は同じアプリのウィンドウで共有されるうえ、jotai は storage
// イベントを購読して他ウィンドウの変更を取り込む。同じキーを使うと、片方で
// サイドバーを閉じただけでもう片方まで閉じてしまう。キーにラベルを混ぜて
// 保存先を分け、storage イベントの照合からも外す。
// メインウィンドウは従来のキーのままにして、保存済みの設定を引き継ぐ。
export function scopedKey(key: string, label: string): string {
  return label === MAIN_LABEL ? key : `${key}:${label}`;
}

export function windowScopedKey(key: string): string {
  return scopedKey(key, currentWindowLabel());
}

// フォルダ（と任意でファイル 1 つ）を新しいウィンドウで開く。
export async function openDocWindow(
  folderId: string,
  file: string | null,
  title: string,
): Promise<void> {
  await invoke("open_doc_window", {
    url: `index.html${buildHash(folderId, file)}`,
    title,
  });
}

export async function setWindowTitle(title: string): Promise<void> {
  await invoke("set_window_title", { label: currentWindowLabel(), title });
}

// Dock メニューが読む履歴。WebView の IndexedDB は Rust から見えないので別に控える。
export async function recordRecentFolder(path: string, at: number): Promise<void> {
  await invoke("record_recent_folder", { path, at });
}
