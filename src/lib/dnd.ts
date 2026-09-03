// ドラッグ&ドロップで受け渡す内容。
//
// 運ぶ先は 3 つある。ファイルツリー → ペイン（開く）、タブ → ペイン（移す）、
// ファイルツリー → ディレクトリ行（ファイルを移動する）。
// パスだけだとタブを掴んだのかツリーから掴んだのか区別できないので、
// タブのときだけ掴んだ位置を添える。

import type { DropPoint } from "./windows";

export const DND_MIME = "application/x-fude-path";

export interface DragPayload {
  path: string;
  from?: { paneId: string; index: number }; // タブを掴んだときだけ付く
}

export function setDragPayload(data: DataTransfer, payload: DragPayload): void {
  data.setData(DND_MIME, JSON.stringify(payload));
}

// ウィンドウの外へ落とされたか。掴んだ側の dragend で判断する。
//
// 受け取られなかったドラッグは dropEffect が none になるが、
// 途中で Esc を押して取り消したときも none になる。取り消しでウィンドウが
// 増えてしまわないよう、指していた位置がウィンドウの外に出ていることも見る。
export function droppedOutside(e: { dataTransfer: DataTransfer; clientX: number; clientY: number }): boolean {
  if (e.dataTransfer.dropEffect !== "none") return false;
  return (
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight
  );
}

// 離した位置（画面座標）。引き出して開いたウィンドウをそこに出すのに使う。
// WebKit が位置を持たないことがあるので、その場合は指定なしにして
// 既定の置き方（既存のウィンドウからずらす）に任せる。
export function dropPoint(e: {
  screenX: number;
  screenY: number;
}): DropPoint | undefined {
  if (e.screenX === 0 && e.screenY === 0) return undefined;
  return { x: e.screenX, y: e.screenY };
}

export function readDragPayload(data: DataTransfer): DragPayload | null {
  const raw = data.getData(DND_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path) return null;
    const from = record.from as Record<string, unknown> | undefined;
    if (from && typeof from.paneId === "string" && typeof from.index === "number") {
      return { path: record.path, from: { paneId: from.paneId, index: from.index } };
    }
    return { path: record.path };
  } catch {
    return null;
  }
}
