import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

// 外部エディタで開く選択肢。app は macOS の `open -a` に渡すアプリ名で、
// /Applications 配下のアプリ名と一致させる。
export interface ExternalApp {
  id: string;
  label: string;
  icon: string;
  app: string;
}

export const EXTERNAL_APPS: ExternalApp[] = [
  { id: "vscode", label: "VS Code で開く", icon: "code", app: "Visual Studio Code" },
  { id: "zed", label: "Zed で開く", icon: "bolt", app: "Zed" },
];

// Finder で対象を選択状態にして表示する（ファイルなら親フォルダを開いて選択）。
export function revealInFinder(abs: string): void {
  void revealItemInDir(abs).catch(() => {});
}

// 指定アプリで開く。アプリ未インストール時は `open -a` が失敗するが、
// detached 起動なので終了コードは取得できない（呼び出し自体は成功扱い）。
export function openWith(abs: string, app: string): void {
  void openPath(abs, app).catch(() => {});
}
