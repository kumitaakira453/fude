import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

// 外部エディタで開く選択肢。app は macOS の /Applications 配下のアプリ名。
// run はその開き方：app はアプリに渡すだけ、terminal は Ghostty の新しい窓で
// nvim で開く。
export interface ExternalApp {
  id: string;
  label: string;
  icon: string;
  app: string;
  run: "app" | "terminal";
}

export const EXTERNAL_APPS: ExternalApp[] = [
  {
    id: "vscode",
    label: "VS Code で開く",
    icon: "code",
    app: "Visual Studio Code",
    run: "app",
  },
  { id: "zed", label: "Zed で開く", icon: "bolt", app: "Zed", run: "app" },
  { id: "nvim", label: "nvim で開く", icon: "terminal", app: "Ghostty", run: "terminal" },
];

// Finder で対象を選択状態にして表示する（ファイルなら親フォルダを開いて選択）。
export function revealInFinder(abs: string): void {
  void revealItemInDir(abs).catch((e) => {
    void message(`Finder で表示できませんでした。\n${String(e)}`, {
      title: "fude",
      kind: "error",
    });
  });
}

// 指定アプリで開く。失敗したら理由を出す（黙って何も起きないのを避ける）。
export function openWith(abs: string, app: ExternalApp, isDir: boolean): void {
  const done =
    app.run === "app"
      ? invoke("open_in_app", { app: app.app, path: abs })
      : invoke("open_in_terminal", { path: abs, isDir });
  void done.catch((e) => {
    void message(`${app.label.replace(/で開く$/, "")}で開けませんでした。\n${String(e)}`, {
      title: "fude",
      kind: "error",
    });
  });
}

// インストール済みのアプリだけに絞る。未インストールの項目をメニューに出して
// 押しても無反応、という状態を避ける。
export async function availableApps(): Promise<ExternalApp[]> {
  try {
    const found = await invoke<string[]>("installed_apps", {
      apps: EXTERNAL_APPS.map((a) => a.app),
    });
    const set = new Set(found);
    return EXTERNAL_APPS.filter((a) => set.has(a.app));
  } catch {
    // 判定できない場合は全部出す（開けなければエラーを表示する）
    return EXTERNAL_APPS;
  }
}
