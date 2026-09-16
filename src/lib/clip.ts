// 写し取り。
//
// ブラウザの口（navigator.clipboard）は安全な場（secure context）と、押した直後で
// あることを要る。アプリの画面は Tauri の独自の綴りで開いているので、口が無いか
// 断られる。アプリの中ではアプリ側（Rust）の口へ通し、その決まりから外れる。
//
// 成否は返す。黙って諦めると、写せたつもりで貼りに行かれる。

const inApp = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function copyText(text: string): Promise<boolean> {
  if (inApp()) {
    try {
      // 荷はアプリの中でだけ読む。
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      // アプリ側が使えないときは、ブラウザの口へ落ちる。
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
